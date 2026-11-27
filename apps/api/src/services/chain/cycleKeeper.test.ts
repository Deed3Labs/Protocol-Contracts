import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { CHAIN_ERRORS } from './chainErrors';
import { classifySimulationError, type CallRunner, type ChainCall, type KeeperMode } from './keeperKit';
import { creditDefaultMode, cycleSyncMode, dueFor, KEEPER_ABI, runCycleKeeper, type KeeperDeps, type KeeperReader } from './cycleKeeper';

/*
 * The credit keeper against a stand-in day-0 RevolvingIssuer. Its reads and its calls are injected,
 * so nothing here mocks a module (the `ethers` mock elsewhere in this directory leaks between files).
 *
 * The policy is the point: sync a member once a cycle end has passed, never before and never twice
 * for one cycle; leave a frozen line alone between cycle ends; record a default only once the issuer
 * computes it and only with its own switch on; simulate first; oldest first, bounded; and say what
 * happened.
 */

const DAY = 86_400;
const now = 1_800_000_000;
const ISSUER = '0x00000000000000000000000000000000000000a1';
const iface = new ethers.Interface(KEEPER_ABI);

type Member = {
  expiration: number;
  graceLength: number;
  paused: boolean;
  compliant: boolean;
  missedInRow: number;
  cycleEnd: number;
  cureAmount: bigint;
  cureDueAt: number;
  inDefault: boolean;
  drawn: bigint;
  /** What the next judgement does, near enough for the keeper. */
  pays: boolean;
};

let chain: Map<string, Member>;
let sent: { call: string; wallet: string }[];
let simulated: string[];
let notices: { wallet: string; title: string }[];
let alerts: { key: string; subject: string; body: string }[];
let failing: Set<string>;

const reader: KeeperReader = {
  creditPeriods: async (w) => {
    const m = chain.get(w)!;
    return [BigInt(m.expiration ? m.expiration - 30 * DAY : 0), BigInt(m.expiration), BigInt(m.graceLength), m.paused];
  },
  inCompliance: async (w) => chain.get(w)!.compliant,
  inDefault: async (w) => chain.get(w)!.inDefault,
  cycleStateOf: async (w) => {
    const m = chain.get(w)!;
    return { cycleEnd: BigInt(m.cycleEnd), cureAmount: m.cureAmount, cureDueAt: BigInt(m.cureDueAt) };
  },
  totalDrawnOf: async (w) => chain.get(w)!.drawn,
};

/** What `judgeCycle` does for one passed cycle end, near enough: clean, first miss halves, second freezes. */
function judge(wallet: string) {
  const m = chain.get(wallet)!;
  const logs: { topics: string[]; data: string }[] = [];
  const emit = (name: string, args: unknown[]) => {
    const log = iface.encodeEventLog(name, args);
    logs.push({ topics: log.topics, data: log.data });
  };
  if (m.cureAmount > 0n) {
    // Frozen: the cycle end gets its statement, nothing else.
    m.cycleEnd += 30 * DAY;
    return logs;
  }
  if (m.pays) {
    m.missedInRow = 0;
    emit('CycleJudged', [wallet, true, 0, 1, false]);
  } else if (m.missedInRow === 0) {
    m.missedInRow = 1;
    emit('UnsecuredLimitHalved', [wallet, 250_000_000n, 0n]);
    emit('CycleJudged', [wallet, false, 1, 0, false]);
  } else {
    m.missedInRow = 2;
    m.cureAmount = 100_000_000n;
    m.cureDueAt = m.expiration;
    emit('CycleJudged', [wallet, false, 2, 0, false]);
    m.cycleEnd = m.expiration + 30 * DAY;
    return logs; // the period stays expired at the due point, frozen
  }
  m.cycleEnd = Math.max(m.cycleEnd, now) + 30 * DAY;
  m.expiration = m.cycleEnd;
  m.graceLength = 0;
  return logs;
}

const decode = (call: ChainCall) => {
  const parsed = iface.parseTransaction({ data: call.data })!;
  return { name: parsed.name, wallet: String(parsed.args[0]).toLowerCase() };
};

const runner: CallRunner = {
  from: '0x00000000000000000000000000000000000000ee',
  simulate: async (call) => {
    const { name, wallet } = decode(call);
    simulated.push(`${name}:${wallet}`);
    if (name === 'triggerDefault' && !chain.get(wallet)!.inDefault) {
      return classifySimulationError({ data: CHAIN_ERRORS.encodeErrorResult('RevolvingIssuerNotInDefault', [wallet]) });
    }
    return { kind: 'ok', returnData: '0x' };
  },
  send: async (call) => {
    const { name, wallet } = decode(call);
    if (failing.has(wallet)) throw new Error('insufficient funds for gas');
    sent.push({ call: name, wallet });
    const hash = `0x${wallet.slice(2).padStart(64, '0')}`;
    if (name === 'triggerDefault') {
      chain.get(wallet)!.expiration = 0; // the period is deleted
      return { hash, logs: [], status: 1 };
    }
    return { hash, logs: judge(wallet), status: 1 };
  },
};

function deps(over: Partial<KeeperDeps> = {}): KeeperDeps {
  return {
    issuer: ISSUER,
    reader,
    runner,
    syncMode: 'live',
    defaultMode: 'live',
    wallets: async () => [...chain.keys()],
    notify: async (n) => notices.push({ wallet: n.wallet, title: n.title }),
    alert: async (a) => alerts.push(a),
    now,
    ...over,
  };
}

const W = (n: number) => `0x${String(n).padStart(40, '0')}`;

function member(wallet: string, m: Partial<Member>) {
  chain.set(wallet, {
    expiration: now - 5 * DAY,
    graceLength: 0,
    paused: false,
    compliant: false,
    missedInRow: 0,
    cycleEnd: now - 5 * DAY,
    cureAmount: 0n,
    cureDueAt: 0,
    inDefault: false,
    drawn: 400_000_000n,
    pays: true,
    ...m,
  });
}

beforeEach(() => {
  chain = new Map();
  sent = [];
  simulated = [];
  notices = [];
  alerts = [];
  failing = new Set();
});

describe('what is due, from the day-0 issuer', () => {
  test('a cycle end that has passed (expiration, no grace): synced', async () => {
    member(W(1), {});
    expect(await dueFor(reader, W(1), now)).toMatchObject({ call: 'syncCreditPeriod', because: 'cycle_end', since: now - 5 * DAY });
  });

  test('a period still running, no line, or a paused pre-2e period: left alone', async () => {
    member(W(1), { expiration: now + DAY, cycleEnd: now + DAY });
    member(W(2), { expiration: 0 });
    member(W(3), { paused: true });
    for (const w of [W(1), W(2), W(3)]) expect(await dueFor(reader, w, now)).toBeNull();
  });

  test('frozen at a second miss: nothing until the next cycle end, then a sync for its statement', async () => {
    member(W(1), { cureAmount: 1n, cureDueAt: now - 20 * DAY, expiration: now - 20 * DAY, cycleEnd: now + 10 * DAY });
    expect(await dueFor(reader, W(1), now)).toBeNull();
    member(W(2), { cureAmount: 1n, cureDueAt: now - 40 * DAY, expiration: now - 40 * DAY, cycleEnd: now - DAY });
    expect(await dueFor(reader, W(2), now)).toMatchObject({ call: 'syncCreditPeriod', because: 'frozen_cycle_end' });
  });

  test('a computed default is triggerDefault, never a sync', async () => {
    member(W(1), { cureAmount: 1n, cureDueAt: now - 30 * DAY, expiration: now - 30 * DAY, cycleEnd: now - DAY, inDefault: true });
    expect(await dueFor(reader, W(1), now)).toMatchObject({ call: 'triggerDefault', because: 'computed_default' });
  });

  test('a line opened before Phase 2e keeps its grace: synced when it ends, or at expiry if already rebalanced', async () => {
    member(W(1), { expiration: now - DAY, graceLength: 5 * DAY, cycleEnd: 0 });
    member(W(2), { expiration: now - DAY, graceLength: 5 * DAY, cycleEnd: 0, compliant: true });
    member(W(3), { expiration: now - 6 * DAY, graceLength: 5 * DAY, cycleEnd: 0 });
    expect(await dueFor(reader, W(1), now)).toBeNull();
    expect(await dueFor(reader, W(2), now)).toMatchObject({ because: 'clean' });
    expect(await dueFor(reader, W(3), now)).toMatchObject({ because: 'grace_ended' });
  });
});

describe('a pass', () => {
  test('judges what is due, simulates first, says what happened, and tells the member about a miss', async () => {
    member(W(1), {});
    member(W(2), { pays: false });
    member(W(3), { expiration: now + DAY, cycleEnd: now + DAY });
    const run = await runCycleKeeper(deps());
    expect(sent.map((s) => s.wallet).sort()).toEqual([W(1), W(2)]);
    expect(simulated.sort()).toEqual([`syncCreditPeriod:${W(1)}`, `syncCreditPeriod:${W(2)}`]);
    expect(run.results.find((r) => r.wallet === W(1))).toMatchObject({ action: 'judged', clean: true });
    expect(run.results.find((r) => r.wallet === W(2))).toMatchObject({ action: 'judged', clean: false, halved: true, missedInRow: 1 });
    expect(notices).toEqual([{ wallet: W(2), title: 'Your cycle closed with a balance' }]);
  });

  test('a second miss freezes the line: the member is told, and ops that a cure notice needs two signers', async () => {
    member(W(1), { pays: false, missedInRow: 1 });
    const run = await runCycleKeeper(deps());
    expect(run.results[0]).toMatchObject({ frozen: true, missedInRow: 2 });
    expect(notices[0].title).toBe('Your line is paused: two cycles missed');
    expect(alerts.map((a) => a.subject)).toEqual([`Second missed cycle: ${W(1)}`]);
    expect(alerts[0].body).toContain('approveCureNotice');
  });

  test('idempotent: a rerun sends nothing for a cycle already judged, nor for a line frozen between cycle ends', async () => {
    member(W(1), {});
    member(W(2), { pays: false, missedInRow: 1 });
    await runCycleKeeper(deps());
    sent = [];
    const again = await runCycleKeeper(deps());
    expect(sent).toEqual([]);
    expect(again.due).toBe(0);
  });

  test('a computed default is recorded with triggerDefault and alerted with the amount and transaction', async () => {
    member(W(1), { cureAmount: 1n, cureDueAt: now - 30 * DAY, expiration: now - 30 * DAY, cycleEnd: now + DAY, inDefault: true, drawn: 812_340_000n });
    const run = await runCycleKeeper(deps());
    expect(sent).toEqual([{ call: 'triggerDefault', wallet: W(1) }]);
    expect(run.results[0]).toMatchObject({ action: 'defaulted', call: 'triggerDefault' });
    expect(alerts[0].subject).toBe(`Credit default recorded for ${W(1)}`);
    expect(alerts[0].body).toContain('$812.34');
    expect(alerts[0].body).toContain(run.results[0].txHash!);
    sent = [];
    await runCycleKeeper(deps());
    expect(sent).toEqual([]); // the period is gone: nothing more is due
  });

  test('with the default switch off, a member in computed default is left wholly alone (a sync would record it too)', async () => {
    member(W(1), { cureAmount: 1n, cureDueAt: now - 30 * DAY, expiration: now - 30 * DAY, cycleEnd: now - DAY, inDefault: true });
    member(W(2), {});
    const run = await runCycleKeeper(deps({ defaultMode: 'off' }));
    expect(sent).toEqual([{ call: 'syncCreditPeriod', wallet: W(2) }]);
    expect(simulated).not.toContain(`syncCreditPeriod:${W(1)}`);
    expect(run.due).toBe(1);
  });

  test('a refusal by the issuer’s own rule is not due, not a failure', async () => {
    member(W(1), { cureAmount: 1n, cureDueAt: now - 30 * DAY, expiration: now - 30 * DAY, cycleEnd: now + DAY, inDefault: true });
    // Paid between the read and the simulation: the issuer no longer computes the default.
    const flaky: KeeperReader = { ...reader, inDefault: async (w) => { const r = chain.get(w)!.inDefault; chain.get(w)!.inDefault = false; return r; } };
    const run = await runCycleKeeper(deps({ reader: flaky }));
    expect(sent).toEqual([]);
    expect(run.results[0]).toMatchObject({ action: 'not_due' });
    expect(run.results[0].reason).toContain('Not in default');
    expect(alerts).toEqual([]);
  });

  test('dry run: simulates, logs and alerts what it would send, sends nothing', async () => {
    member(W(1), {});
    member(W(2), { cureAmount: 1n, cureDueAt: now - 30 * DAY, expiration: now - 30 * DAY, cycleEnd: now + DAY, inDefault: true });
    const run = await runCycleKeeper(deps({ syncMode: 'dry_run', defaultMode: 'dry_run' }));
    expect(sent).toEqual([]);
    expect(run.results.map((r) => r.action)).toEqual(['would_send', 'would_send']);
    expect(alerts.map((a) => a.subject).sort()).toEqual([
      `Credit keeper (dry run): would send syncCreditPeriod for ${W(1)}`,
      `Credit keeper (dry run): would send triggerDefault for ${W(2)}`,
    ]);
  });

  test('bounded per run, oldest due first; the rest waits for the next run', async () => {
    member(W(1), { expiration: now - 2 * DAY });
    member(W(2), { expiration: now - 9 * DAY });
    member(W(3), { expiration: now - 5 * DAY });
    const run = await runCycleKeeper(deps({ maxPerRun: 2 }));
    expect(sent.map((s) => s.wallet)).toEqual([W(2), W(3)]);
    expect(run.deferred).toBe(1);
  });

  test('a failure is logged and alerted, and does not stop the rest', async () => {
    member(W(1), {});
    member(W(2), {});
    failing.add(W(1));
    const run = await runCycleKeeper(deps());
    expect(sent.map((s) => s.wallet)).toEqual([W(2)]);
    expect(run.results.find((r) => r.wallet === W(1))).toMatchObject({ action: 'failed' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject).toContain('1 call(s) not sent');
  });
});

describe('switches', () => {
  test('syncCreditPeriod stays on unless switched off; triggerDefault is off unless switched on; each has a dry run', () => {
    const modes = (env: Record<string, string>): [KeeperMode, KeeperMode] => [cycleSyncMode(env), creditDefaultMode(env)];
    expect(modes({})).toEqual(['live', 'off']);
    expect(modes({ CYCLE_KEEPER_ENABLED: '0', CREDIT_DEFAULT_KEEPER_ENABLED: '1' })).toEqual(['off', 'live']);
    expect(modes({ CYCLE_KEEPER_DRY_RUN: '1', CREDIT_DEFAULT_KEEPER_ENABLED: 'true', CREDIT_DEFAULT_KEEPER_DRY_RUN: '1' })).toEqual(['dry_run', 'dry_run']);
  });
});

describe('the issuer has what the keeper calls', () => {
  const record = new URL('../../../../../deployments/base-sepolia/RevolvingIssuer.json', import.meta.url);
  test('each function and the cycle-state tuple match the deployed RevolvingIssuer’s ABI', () => {
    if (!existsSync(record)) return; // the API checked out on its own
    const deployed = new ethers.Interface((JSON.parse(readFileSync(record, 'utf8')) as { abi: ethers.InterfaceAbi }).abi);
    for (const f of iface.fragments.filter((x): x is ethers.FunctionFragment => x.type === 'function')) {
      expect(`${f.name} ${deployed.getFunction(f.name)?.selector}`).toBe(`${f.name} ${f.selector}`);
      expect(deployed.getFunction(f.name)!.outputs.map((o) => o.format())).toEqual(f.outputs.map((o) => o.format()));
    }
  });
});

describe('wiring', () => {
  const job = readFileSync(new URL('../../jobs/cycleKeeper.ts', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');

  test('registered at startup, hourly, and only on an issuer that judges its own cycles', () => {
    expect(index).toContain('startCycleKeeper()');
    expect(job).toContain('setInterval(() => void tick(), HOUR_MS)');
    expect(job).toContain('await issuerJudgesCycles()');
  });

  test('syncCreditPeriod and triggerDefault need no role, only gas: the README says so', () => {
    expect(readme).toMatch(/syncCreditPeriod[^\n]*\|[^\n]*no role/i);
    expect(readme).toMatch(/triggerDefault[^\n]*\|[^\n]*no role/i);
  });
});
