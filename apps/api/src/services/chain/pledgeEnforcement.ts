import { ethers } from 'ethers';
import { getPostgresPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';
import { chainErrorReason } from './chainErrors.js';
import { alertOps } from '../opsAlert.js';
import { memberWallets } from './cycleKeeper.js';
import { LIQUIDATOR_ABI } from './enforcement.js';
import {
  dayKey,
  envCount,
  hourKey,
  keeperChainId,
  keeperKey,
  keeperMode,
  liveRunner,
  parseLogs,
  usdOf,
  type CallRunner,
  type ChainCall,
  type KeeperMode,
} from './keeperKit.js';

/*
 * The pledge keepers (decision 53, item 1): they settle an Earn default or an Earn shortfall past its
 * wait from the member's pledged collateral, by calling only what the contracts let anyone call, when
 * the contracts say it is due. Phase 2f's order is the contracts' own: on a default, pledged bonds come
 * before pool shares (decision 10), on a shortfall pool shares come first (decision 21); the
 * PoolShareEnforcer and the Liquidator compute that, so the keeper never chooses an amount or a bond.
 *
 * Pool shares (POOL_ENFORCE_KEEPER_ENABLED), on the PoolShareEnforcer:
 *   - `settle(holder)` once the Yield Pool's queue has paid some of the holder's enforcement request
 *     (`enforcementFilledOf` above the enforcer's `settledShares`/`settledPaid`): the Liquidator
 *     applies the proceeds and pays any surplus to the Holder;
 *   - `cancelExcess(holder, requestId)` when more is queued than is needed now (the member paid,
 *     cured or released): those shares go back to the Holder;
 *   - `enforce(holder)` when `sharesNeeded(holder)` is above zero: queues only the pledged shares
 *     still needed, as an enforcement redemption in the pool's ordinary queue. The queue keeper
 *     (`fillQueue`) and then `settle` finish it.
 * Bonds (BOND_PLEDGE_KEEPER_ENABLED), on the BurnerBond collection:
 *   - `payPledged(bondId)` for the bond `nextBondOf(holder)` names, when the Liquidator's
 *     `pledgePaymentDue(holder, bondId)` says it is due. One bond per holder per run: each payment is
 *     measured again before the next (MB-05 §7.3(c)).
 *
 * Never while a Liquidation Hold or a 10c pause is in force for the member: the keeper reads both
 * first and leaves a blocked member wholly alone (giving back excess shares included), and the
 * contracts refuse anyway. Every call is simulated first and sent only if it would succeed; a refusal
 * by the contract's own rule is "not due". Reading the chain decides everything, so a rerun or a
 * restart sends nothing twice. Bounded per run (POOL_ENFORCE_KEEPER_MAX_PER_RUN,
 * BOND_PLEDGE_KEEPER_MAX_PER_RUN), most overdue first: defaults, then shortfalls by when their wait
 * ended. Every send alerts ops with the member, the amount and the transaction.
 *
 * Whom to check: every member wallet on record (the members database), as the other keepers do.
 * Pledges are made from the member's own wallet with their signature, so that is where they are.
 */

export const ENFORCER_ABI = [
  'function pool() view returns (address)',
  'function liquidator() view returns (address)',
  'function settledShares(address holder) view returns (uint256)',
  'function settledPaid(address holder) view returns (uint256)',
  'function sharesNeeded(address holder) view returns (uint256 shares, uint256 value, bool onDefault)',
  'function valueNeeded(address holder) view returns (uint256 value, bool onDefault)',
  'function enforce(address holder) returns (uint256 requestId)',
  'function settle(address holder) returns (uint256 applied)',
  'function cancelExcess(address holder, uint256 requestId) returns (uint256 cancelled)',
  'event EnforcementRequested(address indexed holder, uint256 indexed requestId, uint256 shares, uint256 value, bool onDefault)',
  'event EnforcementSettled(address indexed holder, uint256 shares, uint256 proceeds, uint256 applied)',
  'event EnforcementCancelled(address indexed holder, uint256 indexed requestId, uint256 shares)',
];
export const POOL_ABI = [
  'function enforcementQueuedOf(address holder) view returns (uint256)',
  'function enforcementFilledOf(address holder) view returns (uint256 shares, uint256 paid)',
  'function previewWithdraw(uint256 assets) view returns (uint256)',
  'function queueHead() view returns (uint256)',
  'function queueLength() view returns (uint256)',
  'function queueRequest(uint256 id) view returns (address owner, address receiver, uint256 shares, uint256 requestedAt, bool enforcement)',
];
export const BOND_ABI = [
  'function payPledged(uint256 bondId) returns (uint256 amount)',
  'function presentValueOf(uint256 bondId) view returns (uint256)',
  'event PledgePaid(uint256 indexed bondId, address indexed holder, uint256 amount, uint256 toDebt, uint256 toHolder)',
];
const PAUSE_CLOCK_ABI = ['function inForce(address member) view returns (bool)'];
const LIQUIDATOR_EXTRA_ABI = [
  'function pauseClock() view returns (address)',
  'function poolShareEnforcer() view returns (address)',
  'function earnBonds() view returns (address)',
  'function earnPool() view returns (address)',
  'function pledgePaymentDue(address member, uint256 bondId) view returns (bool due, address issuer, bool onDefault)',
];
const ENFORCER = new ethers.Interface(ENFORCER_ABI);
const BONDS = new ethers.Interface(BOND_ABI);

export const DEFAULT_POOL_MAX_PER_RUN = 25;
export const DEFAULT_BOND_MAX_PER_RUN = 25;
/** How many queue entries a run looks at to find a holder's enforcement requests. */
export const QUEUE_SCAN_MAX = 2000;

export interface HolderState {
  /** A confirmed Liquidation Hold active now, or a 10c pause in force. */
  blocked: boolean;
  defaultedDue: bigint;
  shortfallGap: bigint;
  shortfallDueAt: number;
  queued: bigint;
  filledShares: bigint;
  filledPaid: bigint;
  settledShares: bigint;
  settledPaid: bigint;
}

export interface PledgeReader {
  holder(wallet: string): Promise<HolderState>;
  sharesNeeded(wallet: string): Promise<{ shares: bigint; value: bigint; onDefault: boolean }>;
  /** Shares still needed now, `previewWithdraw(valueNeeded)`. */
  sharesStillNeeded(wallet: string): Promise<bigint>;
  /** Open enforcement requests in the queue, by holder (lower-case), oldest first. */
  enforcementRequests(): Promise<Map<string, bigint[]>>;
  nextBond(wallet: string): Promise<{ found: boolean; bondId: bigint }>;
  pledgePaymentDue(wallet: string, bondId: bigint): Promise<{ due: boolean; onDefault: boolean }>;
  bondValue(bondId: bigint): Promise<bigint>;
}

export type PledgeAction = 'settle' | 'cancelExcess' | 'enforce' | 'payPledged';

export interface PledgeDeps {
  enforcer: string;
  bonds: string;
  reader: PledgeReader;
  runner: CallRunner;
  poolMode: KeeperMode;
  bondMode: KeeperMode;
  wallets: () => Promise<string[]>;
  alert: (input: { key: string; subject: string; body: string }) => Promise<unknown>;
  now?: number;
  poolMaxPerRun?: number;
  bondMaxPerRun?: number;
}

export interface PledgeResult {
  wallet: string;
  action: PledgeAction | 'read';
  outcome: 'sent' | 'would_send' | 'not_due' | 'failed';
  txHash?: string;
  /** What moved, in words: shares, dollars, the bond. */
  detail?: string;
  reason?: string;
}

export interface PledgeRun {
  checked: number;
  held: number;
  results: PledgeResult[];
  /** Due calls left for the next run by the per-run bounds. */
  deferred: number;
}

interface Candidate {
  wallet: string;
  since: number;
  state: HolderState;
}

/** Whether anything here could be due for this holder, from the cheap reads. */
export function mayNeedWork(s: HolderState, now: number): boolean {
  const enforceable = s.defaultedDue > 0n || (s.shortfallGap > 0n && s.shortfallDueAt > 0 && now >= s.shortfallDueAt);
  return enforceable || s.queued > 0n || s.filledShares > s.settledShares || s.filledPaid > s.settledPaid;
}

let running = false;

export async function runPledgeKeepers(deps: PledgeDeps): Promise<PledgeRun> {
  const run: PledgeRun = { checked: 0, held: 0, results: [], deferred: 0 };
  if (running || (deps.poolMode === 'off' && deps.bondMode === 'off')) return run;
  running = true;
  try {
    const now = deps.now ?? Math.floor(Date.now() / 1000);
    const budget = { pool: deps.poolMaxPerRun ?? DEFAULT_POOL_MAX_PER_RUN, bond: deps.bondMaxPerRun ?? DEFAULT_BOND_MAX_PER_RUN };

    const candidates: Candidate[] = [];
    for (const wallet of await deps.wallets()) {
      run.checked += 1;
      try {
        const state = await deps.reader.holder(wallet);
        if (!mayNeedWork(state, now)) continue;
        if (state.blocked) {
          run.held += 1;
          continue;
        }
        // Most overdue first: a default (no wait), then a shortfall by when its wait ended, then the rest.
        const since = state.defaultedDue > 0n ? 0 : state.shortfallDueAt > 0 && now >= state.shortfallDueAt ? state.shortfallDueAt : now;
        candidates.push({ wallet, since, state });
      } catch (error) {
        run.results.push({ wallet, action: 'read', outcome: 'failed', reason: chainErrorReason(error).slice(0, 300) });
      }
    }
    candidates.sort((a, b) => a.since - b.since);

    let requests: Map<string, bigint[]> | null = null;
    const modeOf = (action: PledgeAction) => (action === 'payPledged' ? deps.bondMode : deps.poolMode);
    const take = (action: PledgeAction): boolean => {
      const key = action === 'payPledged' ? 'bond' : 'pool';
      if (budget[key] <= 0) {
        run.deferred += 1;
        return false;
      }
      budget[key] -= 1;
      return true;
    };

    /** Simulate, then (live) send and alert, or (dry run) report. */
    const attempt = async (wallet: string, action: PledgeAction, call: ChainCall, describe: (logs: ethers.LogDescription[]) => string, preview: string) => {
      const result: PledgeResult = { wallet, action, outcome: 'failed' };
      run.results.push(result);
      try {
        const sim = await deps.runner.simulate(call);
        if (sim.kind === 'refused') return Object.assign(result, { outcome: 'not_due', reason: sim.sentence });
        if (sim.kind === 'failed') return Object.assign(result, { reason: `simulation ${sim.reason}` });
        if (modeOf(action) === 'dry_run') {
          Object.assign(result, { outcome: 'would_send', detail: preview });
          console.log(`[pledge-keepers] dry run: would send ${action} for ${wallet}: ${preview}`);
          await deps
            .alert({
              key: `pledge-keepers:dry-run:${action}:${wallet}:${dayKey(now)}`,
              subject: `Pledge keeper (dry run): would send ${action} for ${wallet}`,
              body: `${action} for ${wallet} simulates successfully from ${deps.runner.from} (${preview}). Nothing was sent: dry run.`,
            })
            .catch(() => null);
          return result;
        }
        const sent = await deps.runner.send(call);
        const iface = action === 'payPledged' ? BONDS : ENFORCER;
        const detail = describe(parseLogs(iface, sent.logs)) || preview;
        Object.assign(result, { outcome: 'sent', txHash: sent.hash, detail });
        await deps
          .alert({
            key: `pledge-keepers:sent:${action}:${wallet}:${sent.hash}`,
            subject: `Enforcement: ${action} sent for ${wallet}`,
            body: `${action} for member ${wallet}: ${detail}. Transaction ${sent.hash}, sent by the pledge keeper from ${deps.runner.from}. The contract allowed it at that moment; no hold or pause was in force.`,
          })
          .catch(() => null);
        return result;
      } catch (error) {
        return Object.assign(result, { outcome: 'failed', reason: chainErrorReason(error).slice(0, 300) });
      }
    };

    for (const { wallet, state } of candidates) {
      try {
        if (deps.poolMode !== 'off') {
          // 1. Hand over what the queue has already paid.
          if ((state.filledShares > state.settledShares || state.filledPaid > state.settledPaid) && take('settle')) {
            const shares = state.filledShares - state.settledShares;
            const paid = state.filledPaid - state.settledPaid;
            await attempt(
              wallet,
              'settle',
              { to: deps.enforcer, data: ENFORCER.encodeFunctionData('settle', [wallet]) },
              (logs) => {
                const e = logs.find((l) => l.name === 'EnforcementSettled');
                return e ? `${e.args.shares} pool shares redeemed for ${usdOf(e.args.proceeds)}, ${usdOf(e.args.applied)} applied to the debt, the rest to the Holder` : '';
              },
              `${shares} pool shares redeemed for ${usdOf(paid)} to apply`,
            );
          }
          // 2. Give back what is queued beyond what is needed now.
          if (state.queued > 0n) {
            const needed = await deps.reader.sharesStillNeeded(wallet);
            if (state.queued > needed) {
              requests ??= await deps.reader.enforcementRequests();
              for (const requestId of requests.get(wallet.toLowerCase()) ?? []) {
                if (!take('cancelExcess')) break;
                const r = await attempt(
                  wallet,
                  'cancelExcess',
                  { to: deps.enforcer, data: ENFORCER.encodeFunctionData('cancelExcess', [wallet, requestId]) },
                  (logs) => {
                    const e = logs.find((l) => l.name === 'EnforcementCancelled');
                    return e ? `${e.args.shares} queued pool shares of request ${requestId} given back to the Holder` : '';
                  },
                  `up to ${state.queued - needed} queued pool shares of request ${requestId} given back (${state.queued} queued, ${needed} needed)`,
                );
                if (r.outcome !== 'sent') break; // a dry run, a refusal or a failure: the rest waits
              }
            }
          }
          // 3. Queue what is still needed.
          const enforceable = state.defaultedDue > 0n || (state.shortfallGap > 0n && state.shortfallDueAt > 0 && now >= state.shortfallDueAt);
          if (enforceable) {
            const need = await deps.reader.sharesNeeded(wallet);
            if (need.shares > 0n && take('enforce')) {
              await attempt(
                wallet,
                'enforce',
                { to: deps.enforcer, data: ENFORCER.encodeFunctionData('enforce', [wallet]) },
                (logs) => {
                  const e = logs.find((l) => l.name === 'EnforcementRequested');
                  return e
                    ? `${e.args.shares} pledged pool shares (${usdOf(e.args.value)} of Pool Share Value) queued as enforcement request ${e.args.requestId}, for ${e.args.onDefault ? 'a default' : 'a shortfall past its wait'}`
                    : '';
                },
                `${need.shares} pledged pool shares (${usdOf(need.value)}) to queue, for ${need.onDefault ? 'a default' : 'a shortfall past its wait'}`,
              );
            }
          }
        }
        // 4. The next pledged bond, if the Liquidator asks for it.
        const bondsDue = state.defaultedDue > 0n || (state.shortfallGap > 0n && state.shortfallDueAt > 0 && now >= state.shortfallDueAt);
        if (deps.bondMode !== 'off' && bondsDue) {
          const next = await deps.reader.nextBond(wallet);
          if (next.found) {
            const due = await deps.reader.pledgePaymentDue(wallet, next.bondId);
            if (due.due && take('payPledged')) {
              const value = await deps.reader.bondValue(next.bondId).catch(() => null);
              await attempt(
                wallet,
                'payPledged',
                { to: deps.bonds, data: BONDS.encodeFunctionData('payPledged', [next.bondId]) },
                (logs) => {
                  const e = logs.find((l) => l.name === 'PledgePaid');
                  return e
                    ? `bond ${e.args.bondId} paid at its Accreted Value ${usdOf(e.args.amount)}: ${usdOf(e.args.toDebt)} to the debt, ${usdOf(e.args.toHolder)} to the Holder`
                    : '';
                },
                `bond ${next.bondId}${value != null ? ` (Accreted Value ${usdOf(value)})` : ''} to pay, for ${due.onDefault ? 'a default' : 'a shortfall past its wait'}`,
              );
            }
          }
        }
      } catch (error) {
        run.results.push({ wallet, action: 'read', outcome: 'failed', reason: chainErrorReason(error).slice(0, 300) });
      }
    }

    const failed = run.results.filter((r) => r.outcome === 'failed');
    if (failed.length) {
      for (const f of failed) console.error(`[pledge-keepers] ${f.action} ${f.wallet} failed: ${f.reason}`);
      await deps
        .alert({
          key: `pledge-keepers:failures:${hourKey(now)}`,
          subject: `Pledge keepers: ${failed.length} call(s) failed`,
          body:
            `Failed or unreadable: ${failed.map((f) => `${f.action} ${f.wallet} (${f.reason})`).join('; ')}. ` +
            'Every call is permissionless and needs only gas: check the card settler key has ETH, and the RPC. The next run retries from what the chain says then.',
        })
        .catch(() => null);
    }
    return run;
  } finally {
    running = false;
  }
}

/* ---- Wiring ---- */

export const poolEnforceMode = (env: Record<string, string | undefined> = process.env) => keeperMode('POOL_ENFORCE_KEEPER', env);
export const bondPledgeMode = (env: Record<string, string | undefined> = process.env) => keeperMode('BOND_PLEDGE_KEEPER', env);

interface Addresses {
  liquidator: string;
  enforcer: string;
  pool: string;
  bonds: string;
}

function addresses(chainId: number): Addresses | null {
  const liquidator = getContractAddress(chainId, 'Liquidator');
  const enforcer = getContractAddress(chainId, 'PoolShareEnforcer');
  const pool = getContractAddress(chainId, 'LendingPool');
  const bonds = getContractAddress(chainId, 'BurnerBond');
  return liquidator && enforcer && pool && bonds ? { liquidator, enforcer, pool, bonds } : null;
}

export function isPledgeKeeperConfigured(): boolean {
  return Boolean(addresses(keeperChainId()) && keeperKey() && getPostgresPool());
}

/**
 * Null when the configured addresses are the ones the Liquidator itself uses; else why not. A keeper
 * pointed at the wrong enforcer, pool or bond collection would only waste gas on refusals, but it is
 * a sign the environment is stale, so it does not run.
 */
export async function pledgeWiringProblem(): Promise<string | null> {
  const chainId = keeperChainId();
  const a = addresses(chainId);
  if (!a) return 'needs the Liquidator, PoolShareEnforcer, LendingPool and BurnerBond addresses';
  try {
    const l = new ethers.Contract(a.liquidator, LIQUIDATOR_EXTRA_ABI, chainProvider(chainId));
    const [enforcer, bonds, pool] = (await Promise.all([l.poolShareEnforcer(), l.earnBonds(), l.earnPool()])) as string[];
    const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
    if (!same(enforcer, a.enforcer)) return `the Liquidator's poolShareEnforcer is ${enforcer}, not ${a.enforcer} (POOL_SHARE_ENFORCER_84532)`;
    if (!same(bonds, a.bonds)) return `the Liquidator's earnBonds is ${bonds}, not ${a.bonds} (BURNER_BOND_84532)`;
    if (!same(pool, a.pool)) return `the Liquidator's earnPool is ${pool}, not ${a.pool} (LENDING_POOL_84532)`;
    return null;
  } catch (error) {
    return `could not read the Liquidator's wiring: ${chainErrorReason(error)}`;
  }
}

export function chainPledgeReader(chainId: number, a: Addresses): PledgeReader {
  const provider = chainProvider(chainId);
  const liquidator = new ethers.Contract(a.liquidator, [...LIQUIDATOR_ABI, ...LIQUIDATOR_EXTRA_ABI], provider);
  const enforcer = new ethers.Contract(a.enforcer, ENFORCER_ABI, provider);
  const pool = new ethers.Contract(a.pool, POOL_ABI, provider);
  const bonds = new ethers.Contract(a.bonds, BOND_ABI, provider);
  let clock: Promise<ethers.Contract | null> | null = null;
  const pauseClock = () =>
    (clock ??= (liquidator.pauseClock() as Promise<string>).then((addr) =>
      addr && addr !== ethers.ZeroAddress ? new ethers.Contract(addr, PAUSE_CLOCK_ABI, provider) : null,
    ));
  return {
    holder: async (w) => {
      const c = await pauseClock();
      const [hold, paused, defaulted, shortfall, queued, filled, settledShares, settledPaid] = await Promise.all([
        liquidator.holdOf(w) as Promise<readonly unknown[]>,
        c ? (c.inForce(w) as Promise<boolean>) : Promise.resolve(false),
        liquidator.earnDefaultedOf(w) as Promise<[bigint, string]>,
        liquidator.shortfallOf(w) as Promise<[bigint, bigint]>,
        pool.enforcementQueuedOf(w) as Promise<bigint>,
        pool.enforcementFilledOf(w) as Promise<[bigint, bigint]>,
        enforcer.settledShares(w) as Promise<bigint>,
        enforcer.settledPaid(w) as Promise<bigint>,
      ]);
      return {
        blocked: Boolean(hold[1]) || Boolean(paused),
        defaultedDue: defaulted[0],
        shortfallGap: shortfall[0],
        shortfallDueAt: Number(shortfall[1]),
        queued,
        filledShares: filled[0],
        filledPaid: filled[1],
        settledShares,
        settledPaid,
      };
    },
    sharesNeeded: async (w) => {
      const [shares, value, onDefault] = (await enforcer.sharesNeeded(w)) as [bigint, bigint, boolean];
      return { shares, value, onDefault };
    },
    sharesStillNeeded: async (w) => {
      const [value] = (await enforcer.valueNeeded(w)) as [bigint, boolean];
      return value === 0n ? 0n : ((await pool.previewWithdraw(value)) as bigint);
    },
    enforcementRequests: async () => {
      const [head, length] = (await Promise.all([pool.queueHead(), pool.queueLength()])) as [bigint, bigint];
      const end = Number(length) < Number(head) + QUEUE_SCAN_MAX ? Number(length) : Number(head) + QUEUE_SCAN_MAX;
      const out = new Map<string, bigint[]>();
      for (let i = Number(head); i < end; i += 50) {
        const ids = Array.from({ length: Math.min(50, end - i) }, (_, k) => BigInt(i + k));
        const rows = (await Promise.all(ids.map((id) => pool.queueRequest(id)))) as Array<[string, string, bigint, bigint, boolean]>;
        rows.forEach(([owner, , shares, , enforcement], k) => {
          if (!enforcement || shares === 0n) return;
          const key = owner.toLowerCase();
          out.set(key, [...(out.get(key) ?? []), ids[k]]);
        });
      }
      return out;
    },
    nextBond: async (w) => {
      const [found, bondId] = (await liquidator.nextBondOf(w)) as [boolean, bigint];
      return { found, bondId };
    },
    pledgePaymentDue: async (w, bondId) => {
      const [due, , onDefault] = (await liquidator.pledgePaymentDue(w, bondId)) as [boolean, string, boolean];
      return { due, onDefault };
    },
    bondValue: (bondId) => bonds.presentValueOf(bondId) as Promise<bigint>,
  };
}

export function pledgeDeps(env: Record<string, string | undefined> = process.env): PledgeDeps | null {
  const chainId = keeperChainId(env);
  const a = addresses(chainId);
  if (!a || !keeperKey(env)) return null;
  return {
    enforcer: a.enforcer,
    bonds: a.bonds,
    reader: chainPledgeReader(chainId, a),
    runner: liveRunner(chainId, keeperKey(env)),
    poolMode: poolEnforceMode(env),
    bondMode: bondPledgeMode(env),
    wallets: memberWallets,
    alert: (input) => alertOps(input),
    poolMaxPerRun: envCount('POOL_ENFORCE_KEEPER_MAX_PER_RUN', DEFAULT_POOL_MAX_PER_RUN, env),
    bondMaxPerRun: envCount('BOND_PLEDGE_KEEPER_MAX_PER_RUN', DEFAULT_BOND_MAX_PER_RUN, env),
  };
}
