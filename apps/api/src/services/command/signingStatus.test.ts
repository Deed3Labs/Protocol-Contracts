import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { encodeFunctionData, getAddress, keccak256, parseAbi, toHex, type Address, type Hex } from 'viem';
import { SafeServiceError, type SafeReader, type SafeTx } from './safe.js';
import { CHECK_EVERY_MS, checkOf, checkPlan, signingStatus, timelockId, type SigningChain } from './signingStatus.js';
import type { SigningPlanFile } from './signing.js';

/* Build → Signing, live: where each open step of the plan stands, from a stand-in chain and Safe service. No network. */

const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, '0')}`) as Address;
const SAFE = A(0x5afe);
const TL = A(0x71);
const TARGET = A(0x99);
const OWNER_1 = A(0xa1);
const OWNER_2 = A(0xa2);
const ZERO = `0x${'00'.repeat(32)}` as Hex;
const SALT = keccak256(toHex('salt'));
const NOW = 1_795_000_000;

const tl = parseAbi([
  'function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)',
  'function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt)',
  'function executeBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt)',
  'function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)',
  'function grantRole(bytes32 role, address account)',
  'function setThing(uint256 x)',
]);
const inner = encodeFunctionData({ abi: tl, functionName: 'setThing', args: [7n] });
const scheduleData = encodeFunctionData({ abi: tl, functionName: 'schedule', args: [TARGET, 0n, inner, ZERO, SALT, 604800n] });
const executeData = encodeFunctionData({ abi: tl, functionName: 'execute', args: [TARGET, 0n, inner, ZERO, SALT] });
const OP = timelockId('execute', [TARGET, 0n, inner, ZERO, SALT]);

const step = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  stage: 'Day 7',
  title: `Run ${id}`,
  explanation: 'x',
  kind: 'safe',
  signer: SAFE,
  signerLabel: 'the Safe',
  chainId: 84532,
  to: TL,
  toLabel: 'Earn timelock',
  value: '0',
  data: executeData,
  functionSignature: 'execute(address,uint256,bytes,bytes32,bytes32)',
  args: [],
  dependsOn: [] as string[],
  status: 'waiting',
  reason: 'Not yet.',
  ...o,
});
const planOf = (steps: ReturnType<typeof step>[]): SigningPlanFile => ({
  format: 'clear-signing-plan/1',
  generatedAt: '2026-11-18T00:00:00Z',
  network: 'base-sepolia',
  chainId: 84532,
  block: 1,
  blockTime: '2026-11-18T00:00:00Z',
  stepsSha256: `sha-${steps.map((s) => s.id).join()}`,
  notes: [],
  steps,
});

/** A chain where each timelock id has a timestamp, each role a holder, and some calls revert. */
function chainOf(o: { ts?: Record<string, bigint>; roles?: Set<string>; reverts?: Record<string, string>; failHead?: boolean } = {}) {
  const seen = { dryRuns: [] as string[], reads: 0 };
  const chain: SigningChain = {
    head: async () => {
      if (o.failHead) throw new Error('node down');
      return { number: 100, timestamp: NOW };
    },
    reads: async (calls) => {
      seen.reads++;
      return calls.map((c) => (c.functionName === 'getTimestamp' ? (o.ts?.[String(c.args[0])] ?? 0n) : c.functionName === 'hasRole' ? (o.roles?.has(`${c.args[0]}:${c.args[1]}`) ?? false) : new Error('no such read')));
    },
    slot: async () => undefined,
    dryRun: async (_from, _to, data) => {
      seen.dryRuns.push(data);
      return o.reverts?.[data] ?? null;
    },
  };
  return { chain, seen };
}

const tx = (o: Partial<SafeTx>): SafeTx => ({
  safeTxHash: `0x${'ab'.repeat(32)}`,
  nonce: 5,
  to: TL,
  value: '0',
  data: executeData,
  method: 'execute',
  confirmationsRequired: 2,
  confirmations: [],
  executed: false,
  executedAt: null,
  submittedAt: '2026-11-25T00:00:00Z',
  proposer: null,
  ...o,
});
function safesOf(o: { pending?: SafeTx[]; executed?: SafeTx[]; nonce?: number; failWith?: number[] } = {}) {
  const fails = [...(o.failWith ?? [])];
  const calls: string[] = [];
  const reader: SafeReader = {
    info: async () => ({ owners: [OWNER_1, OWNER_2], threshold: 2, nonce: o.nonce ?? 5 }),
    transactions: async (_c, { executed }) => {
      calls.push(executed ? 'executed' : 'pending');
      const f = fails.shift();
      if (f) throw new SafeServiceError(f, `The Safe Transaction Service said ${f}`);
      return executed ? (o.executed ?? []) : (o.pending ?? []);
    },
    transaction: async () => null,
    propose: async () => undefined,
    confirm: async () => undefined,
    read: async () => 0n,
  };
  return { reader, calls };
}

const run = (plan: SigningPlanFile, chain = chainOf().chain, safes = safesOf().reader) => checkPlan(plan, { chain, safes, now: NOW * 1000, pause: async () => undefined });

describe('a timelock step', () => {
  test('schedule and execute of the same call share one id', () => {
    expect(checkOf(step('s', { data: scheduleData }))).toEqual({ kind: 'timelock', phase: 'schedule', id: OP });
    expect(checkOf(step('x'))).toEqual({ kind: 'timelock', phase: 'execute', id: OP });
    const b = [[TARGET], [0n], [inner], ZERO, SALT] as const;
    const sb = encodeFunctionData({ abi: tl, functionName: 'scheduleBatch', args: [...b, 1n] });
    const eb = encodeFunctionData({ abi: tl, functionName: 'executeBatch', args: b });
    expect((checkOf(step('sb', { data: sb })) as { id: Hex }).id).toBe((checkOf(step('eb', { data: eb })) as { id: Hex }).id);
  });

  test('the real Base Sepolia operation ids, from the committed plan', () => {
    const file = new URL('../../../../../deployments/base-sepolia/signing-plan.json', import.meta.url).pathname;
    if (!existsSync(file)) return;
    const plan = JSON.parse(readFileSync(file, 'utf8')) as SigningPlanFile;
    const sa = plan.steps.find((s) => s.id === 'SAx-attester-execute');
    if (!sa) return;
    const id = (checkOf(sa as never) as { id: Hex }).id;
    // the state attester grant, operation 0x80b2…2cd6 on the credit timelock
    expect(id.slice(0, 6)).toBe('0x80b2');
    expect(id.slice(-4)).toBe('2cd6');
  });

  test('run: done; scheduled and due: a dry run decides; not yet due: waits with when; not scheduled: waits', async () => {
    const plan = planOf([step('E1')]);
    expect((await run(plan, chainOf({ ts: { [OP]: 1n } }).chain)).steps.E1).toMatchObject({ status: 'done', by: 'timelock' });
    expect((await run(plan, chainOf({ ts: { [OP]: BigInt(NOW - 60) } }).chain)).steps.E1).toMatchObject({ status: 'ready', by: 'dry-run' });
    expect((await run(plan, chainOf({ ts: { [OP]: BigInt(NOW + 3600) } }).chain)).steps.E1).toMatchObject({ status: 'waiting', by: 'timelock', opensAt: new Date((NOW + 3600) * 1000).toISOString() });
    expect((await run(plan, chainOf().chain)).steps.E1).toMatchObject({ status: 'waiting', why: 'Not scheduled on its timelock yet.' });
  });

  test('a schedule step is done once the timelock knows the operation', async () => {
    const r = await run(planOf([step('S1', { data: scheduleData, status: 'ready' })]), chainOf({ ts: { [OP]: BigInt(NOW + 9) } }).chain);
    expect(r.steps.S1).toMatchObject({ status: 'done', by: 'timelock' });
  });

  test('a due step whose dry run reverts waits, saying why', async () => {
    const r = await run(planOf([step('E1')]), chainOf({ ts: { [OP]: 2n }, reverts: { [executeData]: 'AgentDelayNotOver' } }).chain);
    expect(r.steps.E1).toEqual({ status: 'waiting', why: 'A dry run from its signer reverts: AgentDelayNotOver.', by: 'dry-run' });
  });
});

describe('what the plan already knows', () => {
  test('done stays done and isn’t read again; steps after wait on it; an unknown call or a missing input waits', async () => {
    const roleData = encodeFunctionData({ abi: tl, functionName: 'grantRole', args: [keccak256(toHex('OPERATOR_ROLE')), A(7)] });
    const { chain, seen } = chainOf();
    const r = await run(
      planOf([
        step('D1', { status: 'done', data: roleData, kind: 'wallet' }),
        step('E1', { dependsOn: ['D1', 'S2'] }),
        step('S2', { data: scheduleData }),
        step('N1', { data: null, reason: 'Its value is known after S2.' }),
        step('I1', { data: '0x1234', reason: 'Waiting for input: SETTLEMENT_OFFRAMP_ADDRESS.' }),
      ]),
      chain,
    );
    expect(r.steps.D1).toEqual({ status: 'done', by: 'plan' });
    expect(r.steps.E1).toMatchObject({ status: 'waiting', why: 'Waits for S2 first.', by: 'step' });
    expect(r.steps.N1).toMatchObject({ status: 'waiting', why: 'Its value is known after S2.', by: 'plan' });
    expect(r.steps.I1).toMatchObject({ status: 'waiting', by: 'input' });
    // only S2 got as far as a dry run
    expect(seen.dryRuns).toEqual([scheduleData]);
  });

  test('a role step is done once the role is held', async () => {
    const role = keccak256(toHex('OPERATOR_ROLE'));
    const data = encodeFunctionData({ abi: tl, functionName: 'grantRole', args: [role, A(7)] });
    const r = await run(planOf([step('R1', { kind: 'wallet', signer: A(0xd), data })]), chainOf({ roles: new Set([`${role}:${A(7)}`]) }).chain);
    expect(r.steps.R1).toEqual({ status: 'done', by: 'role' });
  });
});

describe('each Safe’s queue', () => {
  test('a step the Safe executed is done, with its transaction', async () => {
    const data = encodeFunctionData({ abi: tl, functionName: 'setThing', args: [1n] });
    const r = await run(planOf([step('C1', { to: TARGET, data, status: 'ready' })]), chainOf().chain, safesOf({ executed: [tx({ to: TARGET, data, executed: true, transactionHash: '0xfeed' })] }).reader);
    expect(r.steps.C1).toEqual({ status: 'done', by: 'safe', txHash: '0xfeed' });
  });

  test('a queued step shows its signatures and what runs before it; other transactions are listed', async () => {
    const other = tx({ safeTxHash: `0x${'01'.repeat(32)}`, nonce: 5, to: SAFE, data: null, method: null, confirmations: [{ owner: OWNER_1, at: 'x' }, { owner: OWNER_2, at: 'x' }] });
    const mine = tx({ nonce: 6, confirmations: [{ owner: OWNER_1, at: 'x' }] });
    const stale = tx({ safeTxHash: `0x${'02'.repeat(32)}`, nonce: 4 });
    const r = await run(planOf([step('E1')]), chainOf({ ts: { [OP]: 2n } }).chain, safesOf({ pending: [other, mine, stale] }).reader);
    expect(r.steps.E1.status).toBe('ready');
    expect(r.steps.E1.queued).toEqual({
      safeTxHash: mine.safeTxHash,
      nonce: 6,
      signed: [OWNER_1],
      required: 2,
      behind: [5],
      link: `https://app.safe.global/transactions/tx?safe=basesep:${SAFE}&id=multisig_${SAFE}_${mine.safeTxHash}`,
    });
    expect(r.safes[SAFE]).toMatchObject({ owners: [OWNER_1, OWNER_2], threshold: 2, nonce: 5, others: [{ nonce: 5, what: 'A rejection (cancels its nonce)', signed: 2, required: 2 }] });
  });

  test('the service is read one call at a time, trying again when it says too many; a Safe it can’t read says so and the rest goes on', async () => {
    const ok = safesOf({ failWith: [429] });
    await run(planOf([step('E1')]), chainOf({ ts: { [OP]: 2n } }).chain, ok.reader);
    expect(ok.calls).toEqual(['pending', 'pending', 'executed']);
    const down = safesOf({ failWith: [500] });
    const r = await run(planOf([step('E1')]), chainOf({ ts: { [OP]: 2n } }).chain, down.reader);
    expect(r.safes[SAFE].problem).toContain('500');
    expect(r.steps.E1.status).toBe('ready');
  });
});

describe('kept five minutes, read again on Check now', () => {
  test('reads again only when old, the plan changes, or Check now finds it older than seconds', async () => {
    let t = 1_000_000;
    const { chain, seen } = chainOf({ ts: { [OP]: 2n } });
    const s = signingStatus({ chain, safes: safesOf().reader, now: () => t });
    const plan = planOf([step('E1')]);
    await s.current(plan);
    t += 60_000;
    await s.current(plan);
    expect(seen.reads).toBe(1);
    t += CHECK_EVERY_MS;
    await s.current(plan); // the last answer at once, a fresh one behind it
    await s.current(plan);
    expect(seen.reads).toBe(2);
    t += 5_000;
    await s.now(plan); // seconds after a check: the same one
    expect(seen.reads).toBe(2);
    t += 30_000;
    await s.now(plan);
    expect(seen.reads).toBe(3);
    await s.current(planOf([step('E1'), step('E2')]));
    expect(seen.reads).toBe(4);
    s.forget();
    await s.current(planOf([step('E1'), step('E2')]));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.reads).toBe(5);
  });

  test('a failed check says so and tries again on the next ask', async () => {
    let fail = true;
    const { chain } = chainOf({ ts: { [OP]: 2n } });
    const flaky: SigningChain = { ...chain, head: async () => (fail ? Promise.reject(new Error('node down')) : chain.head()) };
    const s = signingStatus({ chain: flaky, safes: safesOf().reader, now: () => 1 });
    await expect(s.current(planOf([step('E1')]))).rejects.toThrow('node down');
    fail = false;
    expect((await s.current(planOf([step('E1')]))).steps.E1.status).toBe('ready');
  });
});
