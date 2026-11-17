import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';
import { chainErrorReason } from './chainErrors.js';
import { alertOps } from '../opsAlert.js';
import { dayKey, envCount, hourKey, keeperChainId, keeperKey, keeperMode, liveRunner, parseLogs, usdOf, type CallRunner, type KeeperMode } from './keeperKit.js';

/*
 * The queue keeper (decision 53, item 1): `LendingPool.fillQueue(maxCount)` on the Yield Pool.
 *
 * A Holder's redemption that Vault Cash could not pay at once waits in the pool's queue, and so does a
 * pledged-share enforcement redemption (PoolShareEnforcer). The queue is filled in order, whole or
 * partly, up to Vault Cash, at the Share Value then, only when someone calls `fillQueue`, which anyone
 * may. Nothing in the contracts calls it on their own: cash that comes back from a Deployment would sit
 * in the vault while the queue waited.
 *
 * Every 15 minutes (QUEUE_FILL_KEEPER_MINUTES), it reads the queue and the vault: shares queued, Vault
 * Cash above zero, the pool not suspended, and no Pool Loss Charge pending (`fillQueue` refuses then).
 * Only then is it simulated; the simulation returns how many requests it would fill, and only a
 * simulation that fills at least one is sent. So a quiet pool costs a few reads and no gas. Each call
 * looks at no more than QUEUE_FILL_KEEPER_MAX_COUNT requests (default 25); what is left waits for the
 * next run. Filling is the contract's arithmetic; the keeper only pays the gas.
 */

export const QUEUE_POOL_ABI = [
  'function queuedShares() view returns (uint256)',
  'function vaultCash() view returns (uint256)',
  'function isSuspended() view returns (bool)',
  'function pendingLossCharge() view returns (bool pending, uint256 id, uint256 amount, uint256 absorbed, uint256 cursor, uint256 end)',
  'function fillQueue(uint256 maxCount) returns (uint256 filled)',
  'event QueueFilled(uint256 indexed requestId, uint256 shares, uint256 gross, uint256 paid, uint256 remainingShares)',
];
const POOL = new ethers.Interface(QUEUE_POOL_ABI);

export const DEFAULT_MAX_COUNT = 25;

export interface QueueState {
  queuedShares: bigint;
  vaultCash: bigint;
  suspended: boolean;
  chargePending: boolean;
}

export interface QueueFillDeps {
  pool: string;
  read: () => Promise<QueueState>;
  runner: CallRunner;
  mode: KeeperMode;
  alert: (input: { key: string; subject: string; body: string }) => Promise<unknown>;
  maxCount?: number;
  now?: number;
}

export interface QueueFillRun {
  state: QueueState | null;
  outcome: 'idle' | 'blocked' | 'nothing_fillable' | 'not_due' | 'would_send' | 'sent' | 'failed';
  /** Requests filled (sent) or that would be (dry run). */
  filled?: number;
  paid?: bigint;
  txHash?: string;
  reason?: string;
}

let running = false;

export async function runQueueFill(deps: QueueFillDeps): Promise<QueueFillRun> {
  if (running || deps.mode === 'off') return { state: null, outcome: 'idle' };
  running = true;
  const now = deps.now ?? Math.floor(Date.now() / 1000);
  const maxCount = deps.maxCount ?? DEFAULT_MAX_COUNT;
  try {
    let state: QueueState;
    try {
      state = await deps.read();
    } catch (error) {
      return failed(deps, now, null, `read: ${chainErrorReason(error)}`);
    }
    if (state.queuedShares === 0n || state.vaultCash === 0n) return { state, outcome: 'idle' };
    if (state.suspended || state.chargePending) {
      return { state, outcome: 'blocked', reason: state.suspended ? 'the pool is suspended' : 'a Pool Loss Charge is pending' };
    }
    const call = { to: deps.pool, data: POOL.encodeFunctionData('fillQueue', [BigInt(maxCount)]) };
    const sim = await deps.runner.simulate(call).catch((error) => ({ kind: 'failed' as const, reason: `simulation: ${chainErrorReason(error)}` }));
    if (sim.kind === 'refused') return { state, outcome: 'not_due', reason: sim.sentence };
    if (sim.kind === 'failed') return failed(deps, now, state, sim.reason);
    const wouldFill = Number(POOL.decodeFunctionResult('fillQueue', sim.returnData)[0]);
    // Shares queued and cash in the vault, but less cash than one share is worth: nothing to fill yet.
    if (wouldFill === 0) return { state, outcome: 'nothing_fillable' };
    if (deps.mode === 'dry_run') {
      console.log(`[queue-fill] dry run: fillQueue(${maxCount}) would fill ${wouldFill} request(s)`);
      await deps
        .alert({
          key: `queue-fill:dry-run:${dayKey(now)}`,
          subject: `Queue keeper (dry run): fillQueue would fill ${wouldFill} request(s)`,
          body: `fillQueue(${maxCount}) on the Yield Pool ${deps.pool} simulates from ${deps.runner.from} and would fill ${wouldFill} queued request(s): ${state.queuedShares} shares queued, Vault Cash ${usdOf(state.vaultCash)}. Nothing was sent: dry run.`,
        })
        .catch(() => null);
      return { state, outcome: 'would_send', filled: wouldFill };
    }
    try {
      const sent = await deps.runner.send(call);
      const fills = parseLogs(POOL, sent.logs).filter((l) => l.name === 'QueueFilled');
      const paid = fills.reduce((sum, f) => sum + BigInt(f.args.paid), 0n);
      return { state, outcome: 'sent', filled: fills.length || wouldFill, paid, txHash: sent.hash };
    } catch (error) {
      return failed(deps, now, state, chainErrorReason(error));
    }
  } finally {
    running = false;
  }
}

async function failed(deps: QueueFillDeps, now: number, state: QueueState | null, reason: string): Promise<QueueFillRun> {
  const short = reason.slice(0, 300);
  console.error(`[queue-fill] failed: ${short}`);
  await deps
    .alert({
      key: `queue-fill:failures:${hourKey(now)}`,
      subject: 'Queue keeper: fillQueue not sent',
      body: `fillQueue on the Yield Pool ${deps.pool} failed: ${short}. It is permissionless and needs only gas: check the card settler key has ETH, and the RPC. The next run retries.`,
    })
    .catch(() => null);
  return { state, outcome: 'failed', reason: short };
}

/* ---- Wiring ---- */

export const queueFillMode = (env: Record<string, string | undefined> = process.env) => keeperMode('QUEUE_FILL_KEEPER', env);
export const queueFillMinutes = (env: Record<string, string | undefined> = process.env) => envCount('QUEUE_FILL_KEEPER_MINUTES', 15, env);

export function queueFillDeps(env: Record<string, string | undefined> = process.env): QueueFillDeps | null {
  const chainId = keeperChainId(env);
  const pool = getContractAddress(chainId, 'LendingPool');
  if (!pool || !keeperKey(env)) return null;
  const reads = new ethers.Contract(pool, QUEUE_POOL_ABI, chainProvider(chainId));
  return {
    pool,
    read: async () => {
      const [queuedShares, vaultCash, suspended, charge] = await Promise.all([
        reads.queuedShares() as Promise<bigint>,
        reads.vaultCash() as Promise<bigint>,
        reads.isSuspended() as Promise<boolean>,
        reads.pendingLossCharge() as Promise<[boolean]>,
      ]);
      return { queuedShares, vaultCash, suspended, chargePending: Boolean(charge[0]) };
    },
    runner: liveRunner(chainId, keeperKey(env)),
    mode: queueFillMode(env),
    alert: (input) => alertOps(input),
    maxCount: envCount('QUEUE_FILL_KEEPER_MAX_COUNT', DEFAULT_MAX_COUNT, env),
  };
}
