import {
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  fallback,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { backupRpcUrl } from '../chain/provider.js';
import { liveSafeReader, SafeServiceError, type SafeConfig, type SafeInfo, type SafeReader, type SafeTx } from './safe.js';
import type { SigningPlanFile } from './signing.js';

/*
 * Build → Signing, live: what the chain and each Safe's queue say about the signing plan's open steps, read
 * at most every five minutes while someone has Command open, and again on "Check now".
 *
 * The committed plan (signing.ts) says which calls make up the rollout and in what order; this says where each
 * one stands now, so the plan script no longer has to be re-run on someone's machine for a step to turn done or
 * ready. A step the plan already records as done stays done. For every other step:
 *
 *   done     the chain shows it: a timelock operation scheduled (a schedule step) or run (an execute step), a
 *            role held or given up, an owner in place, a proxy on its implementation; or, for a Safe step, the
 *            Safe has executed this exact call (to and data) according to its Transaction Service.
 *   waiting  its call isn't known yet (an earlier step decides it: the plan needs a refresh), a step it depends
 *            on isn't done, a timelock's wait hasn't ended (with when it ends), an input the plan names is
 *            missing, or a dry run of its call from its signer reverts.
 *   ready    a dry run of exactly its call, from its signer, succeeds: the plan script's own test.
 *
 * Costs: one multicall for every timelock, role and owner read, a storage read per upgrade, one dry run per step
 * that gets that far, and three Transaction Service reads per Safe with open steps. Reads go to the public node
 * first and to the backup (Alchemy) only when it is rate-limited. Nothing here signs or sends.
 */

export const CHECK_EVERY_MS = 5 * 60_000;
/** "Check now" reads again only when the last check is older than this. */
export const CHECK_NOW_GAP_MS = 20_000;
const BASE_SEPOLIA = 84532;
const SAFE_SHORT = 'basesep';
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as Hex;

export type LiveStatus = 'done' | 'ready' | 'waiting';

/** A step's place in its Safe's queue, from the Transaction Service. */
export interface StepInQueue {
  safeTxHash: string;
  nonce: number;
  signed: string[];
  required: number;
  /** Earlier nonces still waiting in the queue: this one can't run before them. */
  behind: number[];
  link: string;
}

export interface StepLive {
  status: LiveStatus;
  why?: string;
  /** When a timelock's wait ends (ISO), for a step that waits on one. */
  opensAt?: string;
  /** How the status was found: the chain's own read, the Safe's history, a dry run, or the plan. */
  by: 'timelock' | 'role' | 'owner' | 'upgrade' | 'safe' | 'dry-run' | 'plan' | 'input' | 'step';
  /** The transaction that did it, when the Safe's history has it. */
  txHash?: string;
  queued?: StepInQueue;
}

export interface SafeLive {
  address: string;
  owners: string[];
  threshold: number;
  nonce: number;
  /** Queued transactions that aren't any plan step, at or after the Safe's nonce: they run first. */
  others: Array<{ nonce: number; safeTxHash: string; what: string; signed: number; required: number }>;
  link: string;
  problem?: string;
}

export interface SigningLive {
  /** The plan these statuses are for. */
  stepsSha256: string;
  checkedAt: number;
  nextCheckAt: number;
  block: number;
  blockTime: number;
  steps: Record<string, StepLive>;
  safes: Record<string, SafeLive>;
  problem?: string;
}

/** What the check reads from the chain. Injected, so tests use a fake chain. */
export interface SigningChain {
  head(): Promise<{ number: number; timestamp: number }>;
  /** Many views at once (Multicall3); a failed read is an Error in its place. */
  reads(calls: Array<{ address: Address; abi: Abi; functionName: string; args: readonly unknown[] }>): Promise<unknown[]>;
  slot(address: Address, slot: Hex): Promise<Hex | undefined>;
  /** Null when the call succeeds from `from`; else why it reverts. */
  dryRun(from: Address, to: Address, data: Hex): Promise<string | null>;
}

const TIMELOCK = parseAbi([
  'function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)',
  'function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)',
  'function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt)',
  'function executeBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt)',
  'function getTimestamp(bytes32 id) view returns (uint256)',
]);
const ROLES = parseAbi(['function grantRole(bytes32 role, address account)', 'function revokeRole(bytes32 role, address account)', 'function hasRole(bytes32 role, address account) view returns (bool)']);
const OWNERS = parseAbi(['function acceptOwnership()', 'function transferOwnership(address newOwner)', 'function owner() view returns (address)', 'function pendingOwner() view returns (address)']);
const UPGRADES = parseAbi(['function upgradeToAndCall(address newImplementation, bytes data)', 'function upgradeTo(address newImplementation)']);

type Step = SigningPlanFile['steps'][number] & {
  kind?: string;
  signer?: string;
  to?: string;
  data?: string | null;
  status?: string;
  reason?: string;
  dependsOn?: string[];
};

/** What a step's call is, as far as checking it goes. */
type Check =
  | { kind: 'timelock'; phase: 'schedule' | 'execute'; id: Hex }
  | { kind: 'role'; grant: boolean; role: Hex; account: Address }
  | { kind: 'owner'; accept: boolean; who: Address }
  | { kind: 'upgrade'; impl: Address }
  | { kind: 'none' };

/** "on 28 Nov at 00:22 UTC". */
const utc = (seconds: number) => {
  const d = new Date(seconds * 1000);
  return `on ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} at ${d.toISOString().slice(11, 16)} UTC`;
};
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** A TimelockController's id for one call (hashOperation) or a batch (hashOperationBatch). */
export function timelockId(fn: string, args: readonly unknown[]): Hex {
  if (fn === 'schedule' || fn === 'execute')
    return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bytes32' }, { type: 'bytes32' }], args.slice(0, 5) as [Address, bigint, Hex, Hex, Hex]));
  return keccak256(
    encodeAbiParameters([{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'bytes[]' }, { type: 'bytes32' }, { type: 'bytes32' }], [...(args.slice(0, 5) as [Address[], bigint[], Hex[], Hex, Hex])] as [
      Address[],
      bigint[],
      Hex[],
      Hex,
      Hex,
    ]),
  );
}

/** Reads a step's call for what the chain can show about it. */
export function checkOf(step: Step): Check {
  const data = step.data as Hex | null | undefined;
  if (!data || data.length < 10) return { kind: 'none' };
  try {
    const d = decodeFunctionData({ abi: TIMELOCK, data });
    if (d.functionName !== 'getTimestamp') return { kind: 'timelock', phase: d.functionName.startsWith('schedule') ? 'schedule' : 'execute', id: timelockId(d.functionName, d.args as readonly unknown[]) };
  } catch {
    /* not a timelock call */
  }
  try {
    const d = decodeFunctionData({ abi: ROLES, data });
    if (d.functionName === 'grantRole' || d.functionName === 'revokeRole') return { kind: 'role', grant: d.functionName === 'grantRole', role: d.args[0] as Hex, account: getAddress(d.args[1] as string) };
  } catch {
    /* not a role */
  }
  try {
    const d = decodeFunctionData({ abi: OWNERS, data });
    if (d.functionName === 'acceptOwnership') return { kind: 'owner', accept: true, who: getAddress(step.signer as string) };
    if (d.functionName === 'transferOwnership') return { kind: 'owner', accept: false, who: getAddress(d.args[0] as string) };
  } catch {
    /* not ownership */
  }
  try {
    const d = decodeFunctionData({ abi: UPGRADES, data });
    return { kind: 'upgrade', impl: getAddress(d.args[0] as string) };
  } catch {
    /* not an upgrade */
  }
  return { kind: 'none' };
}

export const safeTxLink = (safe: string, safeTxHash: string) => `https://app.safe.global/transactions/tx?safe=${SAFE_SHORT}:${getAddress(safe)}&id=multisig_${getAddress(safe)}_${safeTxHash}`;
export const safeQueueLink = (safe: string) => `https://app.safe.global/transactions/queue?safe=${SAFE_SHORT}:${getAddress(safe)}`;

/** The Transaction Service's view of one Safe, the same service and key the Ops Safe uses. */
export function planSafeConfig(address: string, env: Record<string, string | undefined> = process.env): SafeConfig {
  return {
    address: getAddress(address),
    chainId: BASE_SEPOLIA,
    serviceUrl: (env.SAFE_TX_SERVICE_URL ?? `https://api.safe.global/tx-service/${SAFE_SHORT}`).replace(/\/+$/, ''),
    apiKey: (env.SAFE_API_KEY ?? '').trim() || null,
    rpcUrl: env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
  };
}

/** Whether a Safe transaction is exactly a plan step's call. */
export const isStepCall = (t: Pick<SafeTx, 'to' | 'data' | 'value'>, step: Step) => same(t.to, step.to) && same(t.data ?? '0x', step.data ?? '') && String(t.value ?? '0') === '0';

/** Where every open step of the plan stands now. */
export async function checkPlan(
  plan: SigningPlanFile,
  deps: { chain: SigningChain; safes: SafeReader; safeConfig?: (address: string) => SafeConfig; now: number; pause?: (ms: number) => Promise<unknown> },
): Promise<SigningLive> {
  const cfg = deps.safeConfig ?? ((a: string) => planSafeConfig(a));
  const steps = plan.steps as Step[];
  const open = steps.filter((s) => s.status !== 'done');
  const head = await deps.chain.head();
  const out: SigningLive = { stepsSha256: plan.stepsSha256, checkedAt: deps.now, nextCheckAt: deps.now + CHECK_EVERY_MS, block: head.number, blockTime: head.timestamp, steps: {}, safes: {} };

  // the chain's own reads, in one multicall
  const checks = new Map(open.map((s) => [s.id, checkOf(s)]));
  const reads: Array<{ id: string; what: string; call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] } }> = [];
  for (const s of open) {
    const c = checks.get(s.id)!;
    const at = getAddress(s.to as string);
    if (c.kind === 'timelock') reads.push({ id: s.id, what: 'ts', call: { address: at, abi: TIMELOCK, functionName: 'getTimestamp', args: [c.id] } });
    if (c.kind === 'role') reads.push({ id: s.id, what: 'role', call: { address: at, abi: ROLES, functionName: 'hasRole', args: [c.role, c.account] } });
    if (c.kind === 'owner') {
      reads.push({ id: s.id, what: 'owner', call: { address: at, abi: OWNERS, functionName: 'owner', args: [] } });
      if (!c.accept) reads.push({ id: s.id, what: 'pending', call: { address: at, abi: OWNERS, functionName: 'pendingOwner', args: [] } });
    }
  }
  const answers = reads.length ? await deps.chain.reads(reads.map((r) => r.call)) : [];
  const got = (id: string, what: string) => {
    const i = reads.findIndex((r) => r.id === id && r.what === what);
    const v = i < 0 ? undefined : answers[i];
    return v instanceof Error ? undefined : v;
  };
  const impls = new Map<string, Address | undefined>();
  await Promise.all(
    open
      .filter((s) => checks.get(s.id)!.kind === 'upgrade')
      .map(async (s) => {
        const raw = await deps.chain.slot(getAddress(s.to as string), IMPL_SLOT).catch(() => undefined);
        impls.set(s.id, raw && raw.length >= 42 ? getAddress(`0x${raw.slice(-40)}`) : undefined);
      }),
  );

  // each Safe with open steps: owners, nonce, and its queue and history from the Transaction Service. Without an
  // API key the service allows only a few requests a second, so they go one at a time, waiting and trying again
  // when it says "too many".
  const pause = deps.pause ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const paced = async <T>(f: () => Promise<T>): Promise<T> => {
    for (let i = 0; ; i++) {
      try {
        return await f();
      } catch (e) {
        if (!(e instanceof SafeServiceError && e.status === 429) || i >= 2) throw e;
        await pause(1_200 * (i + 1));
      }
    }
  };
  const queues = new Map<string, { info: SafeInfo; pending: SafeTx[]; executed: SafeTx[] } | null>();
  for (const a of [...new Set(open.filter((s) => s.kind === 'safe').map((s) => getAddress(s.signer as string)))]) {
    const c = cfg(a);
    try {
      const info = await deps.safes.info(c);
      const pending = await paced(() => deps.safes.transactions(c, { executed: false, limit: 50 }));
      const executed = await paced(() => deps.safes.transactions(c, { executed: true, limit: 100 }));
      const live = pending.filter((t) => t.nonce >= info.nonce);
      queues.set(a, { info, pending: live, executed });
      out.safes[a] = {
        address: a,
        owners: info.owners,
        threshold: info.threshold,
        nonce: info.nonce,
        others: live
          .filter((t) => !steps.some((s) => s.kind === 'safe' && same(s.signer, a) && isStepCall(t, s)))
          .sort((x, y) => x.nonce - y.nonce)
          .map((t) => ({ nonce: t.nonce, safeTxHash: t.safeTxHash, what: t.method ?? (t.data ? 'A transaction' : same(t.to, a) ? 'A rejection (cancels its nonce)' : 'A transfer'), signed: t.confirmations.length, required: t.confirmationsRequired })),
        link: safeQueueLink(a),
      };
    } catch (e) {
      queues.set(a, null);
      out.safes[a] = { address: a, owners: [], threshold: 0, nonce: 0, others: [], link: safeQueueLink(a), problem: `Couldn’t read this Safe’s queue: ${(e as Error)?.message ?? e}` };
    }
  }

  const statusOf = (id: string): LiveStatus => out.steps[id]?.status ?? (steps.find((s) => s.id === id)?.status === 'done' ? 'done' : 'waiting');
  const dryRuns: Array<Promise<void>> = [];
  for (const s of steps) {
    if (s.status === 'done') {
      out.steps[s.id] = { status: 'done', by: 'plan' };
      continue;
    }
    const c = checks.get(s.id)!;
    const q = s.kind === 'safe' ? queues.get(getAddress(s.signer as string)) : undefined;
    // done, as the chain or the Safe's history shows it
    const ts = c.kind === 'timelock' ? (got(s.id, 'ts') as bigint | undefined) : undefined;
    let done: StepLive | null = null;
    if (c.kind === 'timelock' && ts !== undefined && (c.phase === 'schedule' ? ts !== 0n : ts === 1n)) done = { status: 'done', by: 'timelock' };
    if (c.kind === 'role' && typeof got(s.id, 'role') === 'boolean' && got(s.id, 'role') === c.grant) done = { status: 'done', by: 'role' };
    if (c.kind === 'owner' && (same(got(s.id, 'owner') as string, c.who) || (!c.accept && same(got(s.id, 'pending') as string, c.who)))) done = { status: 'done', by: 'owner' };
    if (c.kind === 'upgrade' && same(impls.get(s.id), c.impl)) done = { status: 'done', by: 'upgrade' };
    const ran = q?.executed.find((t) => isStepCall(t, s));
    if (!done && ran) done = { status: 'done', by: 'safe' };
    if (done) {
      out.steps[s.id] = { ...done, ...(ran?.transactionHash ? { txHash: ran.transactionHash } : {}) };
      continue;
    }
    // where it is in its Safe's queue, if it's there
    const inQ = q?.pending.find((t) => isStepCall(t, s));
    const queued: StepInQueue | undefined =
      inQ && q
        ? {
            safeTxHash: inQ.safeTxHash,
            nonce: inQ.nonce,
            signed: inQ.confirmations.map((x) => x.owner),
            required: inQ.confirmationsRequired,
            behind: [...new Set(q.pending.filter((t) => t.nonce < inQ.nonce).map((t) => t.nonce))].sort((a, b) => a - b),
            link: safeTxLink(s.signer as string, inQ.safeTxHash),
          }
        : undefined;
    const wait = (why: string, by: StepLive['by'], extra: Partial<StepLive> = {}) => (out.steps[s.id] = { status: 'waiting', why, by, ...(queued ? { queued } : {}), ...extra });
    const blockers = (s.dependsOn ?? []).filter((d) => statusOf(d) !== 'done');
    if (!s.data) wait(s.reason || 'Its call is known only after an earlier step: the plan needs a refresh once that step is done.', 'plan');
    else if (/^Waiting for input/i.test(s.reason ?? '')) wait(s.reason!, 'input');
    else if (blockers.length) wait(`Waits for ${blockers.join(' and ')} first.`, 'step');
    else if (c.kind === 'timelock' && c.phase === 'execute' && ts === 0n) wait('Not scheduled on its timelock yet.', 'timelock');
    else if (c.kind === 'timelock' && c.phase === 'execute' && ts !== undefined && ts > BigInt(head.timestamp))
      wait(`The timelock’s 7 days end ${utc(Number(ts))}.`, 'timelock', { opensAt: new Date(Number(ts) * 1000).toISOString() });
    else {
      // the plan script's own test: exactly its call, from its signer, at the chain's head
      const id = s.id;
      out.steps[id] = { status: 'ready', by: 'dry-run', ...(queued ? { queued } : {}) };
      dryRuns.push(
        deps.chain
          .dryRun(getAddress(s.signer as string), getAddress(s.to as string), s.data as Hex)
          .catch((e) => `couldn’t run it (${(e as Error)?.message ?? e})`)
          .then((why) => {
          if (why !== null) out.steps[id] = { status: 'waiting', why: `A dry run from its signer reverts${why ? `: ${why}` : ''}.`, by: 'dry-run', ...(queued ? { queued } : {}) };
        }),
      );
    }
  }
  await Promise.all(dryRuns);
  return out;
}

/** The chain, read through the public node first and the backup (Alchemy) only when that fails or is rate-limited. */
export function liveSigningChain(env: Record<string, string | undefined> = process.env): SigningChain {
  const primary = env.BASE_SEPOLIA_RPC_URL?.trim() || 'https://sepolia.base.org';
  const backup = backupRpcUrl(BASE_SEPOLIA);
  const client = createPublicClient({ chain: baseSepolia, transport: backup ? fallback([http(primary), http(backup)]) : http(primary), batch: { multicall: true } });
  return {
    async head() {
      const b = await client.getBlock({ blockTag: 'latest' });
      return { number: Number(b.number), timestamp: Number(b.timestamp) };
    },
    async reads(calls) {
      const r = (await client.multicall({ contracts: calls as never, allowFailure: true })) as Array<{ status: 'success' | 'failure'; result?: unknown; error?: Error }>;
      return r.map((x) => (x.status === 'success' ? x.result : new Error(String(x.error?.message ?? 'read failed'))));
    },
    slot: (address, slot) => client.getStorageAt({ address, slot }),
    async dryRun(from, to, data) {
      try {
        await client.call({ account: from, to, data });
        return null;
      } catch (e) {
        const err = e as { shortMessage?: string; details?: string; message?: string };
        return String(err.shortMessage ?? err.details ?? err.message ?? 'reverted').replace(/^Execution reverted with reason:\s*/i, '').slice(0, 240);
      }
    },
  };
}

/**
 * The statuses, kept: read when someone asks and the last check is over five minutes old (the answer they get
 * is the last one while the new one is read, unless there's none yet), at once on "Check now" unless the last
 * check is only seconds old, and afresh when the plan changes.
 */
export function signingStatus(deps: { chain?: SigningChain; safes?: SafeReader; safeConfig?: (address: string) => SafeConfig; now?: () => number } = {}) {
  const now = deps.now ?? (() => Date.now());
  let chain = deps.chain;
  const safes = deps.safes ?? liveSafeReader();
  let kept: { sha: string; startedAt: number; p: Promise<SigningLive>; value?: SigningLive } | null = null;
  const start = (plan: SigningPlanFile) => {
    chain ??= liveSigningChain();
    const entry: NonNullable<typeof kept> = { sha: plan.stepsSha256, startedAt: now(), p: null as unknown as Promise<SigningLive> };
    entry.p = checkPlan(plan, { chain, safes, safeConfig: deps.safeConfig, now: now() }).then(
      (v) => (entry.value = v),
      (e) => {
        // a failed check keeps the last answer, says why, and tries again on the next ask
        const last = kept && kept !== entry ? kept.value : undefined;
        if (kept === entry) kept = last ? { ...entry, value: last, startedAt: 0 } : null;
        throw e;
      },
    );
    kept = entry;
    return entry;
  };
  return {
    /** The last statuses for this plan, reading again when they're over five minutes old. */
    async current(plan: SigningPlanFile): Promise<SigningLive> {
      if (!kept || kept.sha !== plan.stepsSha256) return start(plan).p;
      if (now() - kept.startedAt >= CHECK_EVERY_MS) {
        const last = kept.value;
        const next = start(plan);
        if (last) {
          next.p.catch(() => undefined);
          return last;
        }
        return next.p;
      }
      return kept.value ?? kept.p;
    },
    /** "Check now": a fresh read unless one started only seconds ago. */
    async now(plan: SigningPlanFile): Promise<SigningLive> {
      if (kept && kept.sha === plan.stepsSha256 && now() - kept.startedAt < CHECK_NOW_GAP_MS) return kept.value ?? kept.p;
      return start(plan).p;
    },
    /** Forgets the statuses, so the next ask reads again (after a proposal or a signature). */
    forget() {
      if (kept) kept = { ...kept, startedAt: 0 };
    },
  };
}
