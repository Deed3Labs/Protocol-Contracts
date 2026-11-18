import { ethers } from 'ethers';
import { chainProvider } from './provider.js';
import { chainErrorReason, decodeChainError, describeKeeperRefusal, revertDataOf, type DecodedChainError } from './chainErrors.js';

/*
 * What every chain keeper shares (decision 53, item 1): its on/off/dry-run switch, the wallet that
 * pays its gas, and "simulate, then send only if the simulation succeeds".
 *
 * Every keeper here calls a permissionless upkeep function. None needs a role, a Safe signature or a
 * deploy: the contract decides whether the call does anything, and the keeper only pays the gas. So:
 *   - each call is simulated first (an `eth_call` from the keeper's own address); a revert is never sent;
 *   - a revert with one of the contract's own "not now" errors is the contract saying the call is not
 *     due (a hold, a pause, nothing needed): that is an answer, not a failure;
 *   - any other revert, or an RPC that cannot be reached, is a failure: logged, alerted, retried next run;
 *   - in dry-run the simulation is the last step: what would be sent is logged and alerted, nothing is.
 * Sends from the keeper wallet go one at a time across all keepers in this process (each is mined
 * before the next leaves), so two keepers waking together cannot race for one nonce.
 */

export type KeeperMode = 'off' | 'dry_run' | 'live';

const TRUE = /^(1|true|on|yes)$/i;
const FALSE = /^(0|false|off|no)$/i;

/**
 * A keeper's switch, from `<PREFIX>_ENABLED` and `<PREFIX>_DRY_RUN`. Off unless `_ENABLED` is set
 * (or, for the two keepers that already ran before these switches existed, unless it is set to 0);
 * `_DRY_RUN=1` with it on simulates and reports without sending.
 */
export function keeperMode(prefix: string, env: Record<string, string | undefined> = process.env, onByDefault = false): KeeperMode {
  const raw = (env[`${prefix}_ENABLED`] || '').trim();
  const on = raw ? TRUE.test(raw) && !FALSE.test(raw) : onByDefault;
  if (!on) return 'off';
  return TRUE.test((env[`${prefix}_DRY_RUN`] || '').trim()) ? 'dry_run' : 'live';
}

/** A positive integer from the environment, else the default. */
export function envCount(name: string, fallback: number, env: Record<string, string | undefined> = process.env): number {
  const n = Number((env[name] || '').trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function keeperChainId(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number((env.SAVINGS_DEFAULT_CHAIN_ID || env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

/**
 * The key that pays every keeper's gas: the card settler's, which the cycle and enforcement keepers
 * already used. No keeper has a key of its own. Never logged.
 */
export const keeperKey = (env: Record<string, string | undefined> = process.env) => (env.CARD_SETTLER_PRIVATE_KEY || '').trim();

/** One call to a contract: where, and its calldata. */
export interface ChainCall {
  to: string;
  data: string;
}

export type ReceiptLog = { address?: string; topics: ReadonlyArray<string>; data: string };
export interface SentTx {
  hash: string;
  wait: (confirms?: number) => Promise<{ status?: number | null; logs: ReadonlyArray<ReceiptLog> } | null>;
}

/**
 * The simulation's answer: it would succeed (with its return data), the contract refused it by one of
 * its own rules (`refused`: not due), or it failed some other way (`failed`).
 */
export type Simulation =
  | { kind: 'ok'; returnData: string }
  | { kind: 'refused'; error: DecodedChainError; sentence: string }
  | { kind: 'failed'; reason: string };

export interface CallRunner {
  /** The keeper wallet's address, for the logs. */
  from: string;
  simulate(call: ChainCall): Promise<Simulation>;
  /** Sends and waits for the receipt, one at a time across keepers. */
  send(call: ChainCall): Promise<{ hash: string; logs: ReadonlyArray<ReceiptLog>; status: number | null }>;
}

/** A revert the chain gave (an answer), as opposed to a call that never got one. */
export function isRevert(error: unknown): boolean {
  if (revertDataOf(error)) return true;
  if ((error as { code?: string })?.code !== 'CALL_EXCEPTION') return false;
  const short = String((error as { shortMessage?: string })?.shortMessage ?? '');
  return short.includes('missing revert data') || short.includes('execution reverted');
}

/** Sort a simulation's error into refused (the contract's own "not now"), or failed. */
export function classifySimulationError(error: unknown): Simulation {
  const decoded = decodeChainError(error);
  if (decoded) {
    const sentence = describeKeeperRefusal(decoded);
    if (sentence) return { kind: 'refused', error: decoded, sentence };
  }
  if (isRevert(error)) return { kind: 'failed', reason: `reverts: ${chainErrorReason(error)}`.slice(0, 300) };
  // Unreachable, rate-limited, timed out: thrown so the run counts it as a read failure.
  throw error;
}

let sendChain: Promise<unknown> = Promise.resolve();

/** Runs `fn` after every keeper send queued before it has finished. */
export function withKeeperSendLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = sendChain.then(fn, fn);
  sendChain = next.catch(() => null);
  return next;
}

/** The live runner: simulates as the keeper wallet, sends from it, waits one confirmation. */
export function liveRunner(chainId: number, key: string): CallRunner {
  const provider = chainProvider(chainId);
  const signer = new ethers.Wallet(key, provider);
  const from = signer.address;
  return {
    from,
    simulate: async (call) => {
      try {
        // `from` set: a call that names a sender is never packed into a multicall (provider.ts).
        return { kind: 'ok', returnData: await provider.call({ to: call.to, data: call.data, from }) };
      } catch (error) {
        return classifySimulationError(error);
      }
    },
    send: (call) =>
      withKeeperSendLock(async () => {
        const tx = await signer.sendTransaction({ to: call.to, data: call.data });
        const receipt = await tx.wait(1);
        return { hash: tx.hash, logs: receipt?.logs ?? [], status: receipt?.status ?? null };
      }),
  };
}

/** Parse the logs of `iface` out of a receipt; others are skipped. */
export function parseLogs(iface: ethers.Interface, logs: ReadonlyArray<ReceiptLog>): ethers.LogDescription[] {
  const out: ethers.LogDescription[] = [];
  for (const log of logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed) out.push(parsed);
    } catch {
      /* not one of these */
    }
  }
  return out;
}

/** USDC base units (6 decimals) as dollars, for alerts. */
export const usdOf = (units: bigint) => `$${(Number(units) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The UTC hour and day, for alert keys that repeat at most that often. */
export const hourKey = (now: number) => new Date(now * 1000).toISOString().slice(0, 13);
export const dayKey = (now: number) => new Date(now * 1000).toISOString().slice(0, 10);
