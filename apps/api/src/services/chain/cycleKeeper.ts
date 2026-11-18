import { ethers } from 'ethers';
import { getPostgresPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';
import { chainErrorReason } from './chainErrors.js';
import { notificationStore } from '../notificationStore.js';
import { alertOps } from '../opsAlert.js';
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
  type KeeperMode,
} from './keeperKit.js';

/*
 * The credit keeper (Phase 2b, 12.4-12.5, as the day-0 RevolvingIssuer judges cycles; decision 53).
 *
 * RevolvingIssuer judges a cycle lazily: Clean, missed (the unsecured limit halves), the second miss
 * that freezes the line, and the cycle's statement (12.17) are recorded only when the member
 * transacts or someone calls `syncCreditPeriod(member)`. A default is recorded by
 * `triggerDefault(member)`. Both are permissionless and need only gas, paid here from the card
 * settler's key. A member nobody syncs earns no Clean Cycles and is never halved either.
 *
 * Since Phase 2e cycles are calendar months (`cycleStateOf(member).cycleEnd`), and the credit period
 * is what the issuer keeps in step with them: `creditPeriods(member).expiration` is the next cycle end
 * (or a held close's due point, 10c), with no grace (`graceLength` 0). So, all read from chain:
 *   - sync once `now >= expiration`: the issuer judges every cycle end that has passed and rolls the
 *     period to the next one, so the next run skips the member (idempotent);
 *   - a second miss in a row leaves `cureAmount` set and the period expired at its due point. The
 *     line stays frozen; syncing it again does nothing until the next cycle end passes (its statement
 *     is recorded then), so it is synced only then, not every hour;
 *   - default is computed (`inDefault`): two misses, a two-person cure-notice timestamp, the grace
 *     over, no pause or Income Assurance. Only then is `triggerDefault` sent, and only when its own
 *     switch is on (CREDIT_DEFAULT_KEEPER_ENABLED). A member in computed default is never synced
 *     instead, because a sync would record the default too.
 *   - a line opened before Phase 2e (a grace length, no cycle end) is synced once its grace ends, or
 *     at expiry if it is already rebalanced, as before.
 * Each call is simulated first; a refusal by the issuer's own rule is "not due". Bounded per run,
 * oldest due first; runs never overlap. What the judgement did is read from the receipt and the
 * member is told about a halved limit or a frozen line; ops are told about a second miss (a cure-notice
 * timestamp needs two ATTESTER_ROLE signers) and about every default recorded.
 */

const CYCLE_STATE =
  'tuple(uint64 cycleEnd, uint64 closedAt, uint64 dayChangedAt, uint8 cycleEndDay, uint8 incomePause, bool hybridMode, uint128 rebalanceAmount, uint128 securedMinimum, uint128 paidSinceClose, uint128 assetCarry, uint128 securedPastDue, uint128 pastDueSM, uint128 cureAmount, uint64 cureDueAt, address noticeProposer, address pauseProposer, uint8 pauseCycles, bytes32 autoClearAuthHash, uint64 cardDay, uint128 cardUsed, bool graceEligible, address graceProposer, uint256 graceUses, bytes32 hardshipRef, bytes32 pauseRef, uint8 hardshipRun, uint64 hardshipLastEnd, uint8 closedWorkout, uint64 psAt, uint64 lastCycleEnd, uint64 lastRecordedAt, bool lastStatementRequired, uint256 closeClock, uint256 cureClock, uint64 heldClosedAt, uint64 heldDueAt, uint8 heldWorkout, uint128 heldRA, uint128 heldSM, uint128 heldPaid, uint256 heldClock)';

export const KEEPER_ABI = [
  'function creditPeriods(address member) view returns (uint256 issuedAt, uint256 expiration, uint256 graceLength, bool paused)',
  'function inCompliance(address member) view returns (bool)',
  'function inDefault(address member) view returns (bool)',
  'function totalDrawnOf(address member) view returns (uint256 total)',
  // Reached through the issuer's static forwarder to RevolvingIssuerTerms.
  `function cycleStateOf(address member) view returns (${CYCLE_STATE})`,
  'function creditTerms() view returns (uint128 unsecuredLineCap, uint64 cureWindow, uint8 boostCleanCycles, uint8 boostDepositCycles, bool autoClearOffGlobal)',
  'function syncCreditPeriod(address member) returns (bool)',
  'function triggerDefault(address member)',
  'event CycleJudged(address indexed member, bool clean, uint8 missedInRow, uint8 cleanStreak, bool deposited)',
  'event UnsecuredLimitHalved(address indexed member, uint256 newLimit, uint256 excess)',
  'event CreditLineDefaulted(address member)',
];
const IFACE = new ethers.Interface(KEEPER_ABI);

/** Calls sent per run, at most. A backlog drains oldest first over the next runs. */
export const DEFAULT_MAX_PER_RUN = 50;

export interface CycleStateLite {
  cycleEnd: bigint | number;
  cureAmount: bigint | number;
  cureDueAt: bigint | number;
}

export interface KeeperReader {
  creditPeriods(member: string): Promise<[bigint, bigint, bigint, boolean] | readonly unknown[]>;
  inCompliance(member: string): Promise<boolean>;
  inDefault(member: string): Promise<boolean>;
  cycleStateOf(member: string): Promise<CycleStateLite>;
  totalDrawnOf(member: string): Promise<bigint>;
}

export interface KeeperDeps {
  issuer: string;
  reader: KeeperReader;
  runner: CallRunner;
  /** syncCreditPeriod: the cycle keeper's switch. */
  syncMode: KeeperMode;
  /** triggerDefault: its own switch. */
  defaultMode: KeeperMode;
  wallets: () => Promise<string[]>;
  notify: (input: { wallet: string; title: string; body: string; dedupeKey: string; data: Record<string, unknown> }) => Promise<unknown>;
  alert: (input: { key: string; subject: string; body: string }) => Promise<unknown>;
  now?: number;
  maxPerRun?: number;
}

export type DueBecause = 'cycle_end' | 'grace_ended' | 'clean' | 'frozen_cycle_end' | 'computed_default';

export interface KeeperResult {
  wallet: string;
  call: 'syncCreditPeriod' | 'triggerDefault';
  action: 'judged' | 'defaulted' | 'would_send' | 'not_due' | 'failed';
  because: DueBecause;
  clean?: boolean;
  missedInRow?: number;
  halved?: boolean;
  /** A second miss in a row: the line is frozen until it is paid. */
  frozen?: boolean;
  txHash?: string;
  reason?: string;
}

export interface KeeperRun {
  checked: number;
  due: number;
  results: KeeperResult[];
  /** Due but left for the next run, because of the per-run bound. */
  deferred: number;
}

export interface Due {
  wallet: string;
  since: number;
  call: KeeperResult['call'];
  because: DueBecause;
}

/**
 * What is due for this member now, and since when; null when nothing is: no line, a period still
 * running, a frozen line between cycle ends, or (for a pre-2e line) inside its grace with a balance.
 */
export async function dueFor(reader: KeeperReader, wallet: string, now: number): Promise<Due | null> {
  const [, expiration, graceLength, paused] = (await reader.creditPeriods(wallet)) as [bigint, bigint, bigint, boolean];
  // No period: no line, or a default already recorded (the period is deleted).
  if (Number(expiration) === 0 || paused) return null;
  const state = await reader.cycleStateOf(wallet);
  if (BigInt(state.cureAmount) > 0n) {
    // A second consecutive miss stands unpaid: frozen. Default once computed; until then only a
    // cycle end that passes (its statement) is worth a sync.
    if (await reader.inDefault(wallet)) {
      return { wallet, since: Number(state.cureDueAt), call: 'triggerDefault', because: 'computed_default' };
    }
    const end = Number(state.cycleEnd);
    return end > 0 && now >= end ? { wallet, since: end, call: 'syncCreditPeriod', because: 'frozen_cycle_end' } : null;
  }
  const expiresAt = Number(expiration);
  if (now < expiresAt) return null;
  const grace = Number(graceLength);
  if (grace === 0) return { wallet, since: expiresAt, call: 'syncCreditPeriod', because: 'cycle_end' };
  // A line opened before Phase 2e: judged once its grace ends, or at expiry if already rebalanced.
  if (now >= expiresAt + grace) return { wallet, since: expiresAt + grace, call: 'syncCreditPeriod', because: 'grace_ended' };
  return (await reader.inCompliance(wallet)) ? { wallet, since: expiresAt, call: 'syncCreditPeriod', because: 'clean' } : null;
}

let running = false;

/** One pass: find every member with something due, oldest first, and send up to the bound. */
export async function runCycleKeeper(deps: KeeperDeps): Promise<KeeperRun> {
  const run: KeeperRun = { checked: 0, due: 0, results: [], deferred: 0 };
  if (running) return run; // never two passes at once: a call in flight would be sent twice
  running = true;
  try {
    const now = deps.now ?? Math.floor(Date.now() / 1000);
    const max = deps.maxPerRun ?? DEFAULT_MAX_PER_RUN;
    const modeOf = (call: Due['call']) => (call === 'triggerDefault' ? deps.defaultMode : deps.syncMode);
    const due: Due[] = [];
    for (const wallet of await deps.wallets()) {
      run.checked += 1;
      try {
        const d = await dueFor(deps.reader, wallet, now);
        // A switch that is off leaves its calls alone; a member in computed default is never synced instead.
        if (d && modeOf(d.call) !== 'off') due.push(d);
      } catch (error) {
        run.results.push({ wallet, call: 'syncCreditPeriod', action: 'failed', because: 'cycle_end', reason: `read: ${chainErrorReason(error)}`.slice(0, 300) });
      }
    }
    due.sort((a, b) => a.since - b.since);
    run.due = due.length;
    run.deferred = Math.max(0, due.length - max);

    for (const d of due.slice(0, max)) {
      const result: KeeperResult = { wallet: d.wallet, call: d.call, action: 'failed', because: d.because };
      run.results.push(result);
      try {
        const call = { to: deps.issuer, data: IFACE.encodeFunctionData(d.call, [d.wallet]) };
        const sim = await deps.runner.simulate(call);
        if (sim.kind === 'refused') {
          Object.assign(result, { action: 'not_due', reason: sim.sentence });
          continue;
        }
        if (sim.kind === 'failed') {
          result.reason = `simulation ${sim.reason}`;
          continue;
        }
        const drawn = d.call === 'triggerDefault' ? await deps.reader.totalDrawnOf(d.wallet).catch(() => null) : null;
        if (modeOf(d.call) === 'dry_run') {
          Object.assign(result, { action: 'would_send', reason: 'dry run: the simulation succeeds' });
          console.log(`[cycle-keeper] dry run: would send ${d.call}(${d.wallet}) (${d.because})`);
          await deps
            .alert({
              key: `cycle-keeper:dry-run:${d.call}:${d.wallet}:${dayKey(now)}`,
              subject: `Credit keeper (dry run): would send ${d.call} for ${d.wallet}`,
              body:
                `${d.call}(${d.wallet}) on the RevolvingIssuer ${deps.issuer} simulates successfully from ${deps.runner.from} ` +
                `(${d.because.replace(/_/g, ' ')}). Nothing was sent: dry run.` +
                (drawn != null ? ` Drawn on the line now: ${usdOf(drawn)}.` : ''),
            })
            .catch(() => null);
          continue;
        }
        const sent = await deps.runner.send(call);
        result.txHash = sent.hash;
        if (d.call === 'triggerDefault') {
          result.action = 'defaulted';
          await deps
            .alert({
              key: `credit-default:${d.wallet}:${sent.hash}`,
              subject: `Credit default recorded for ${d.wallet}`,
              body:
                `triggerDefault(${d.wallet}) was sent by the credit keeper from ${deps.runner.from}: ${sent.hash}. ` +
                `The issuer computed the default itself (two missed cycles, the two-person cure-notice timestamp, the grace over). ` +
                (drawn != null ? `Drawn on the line before the write-off: ${usdOf(drawn)}. ` : '') +
                'The period is deleted, this issuer’s share written off and the line closed; pledged collateral is now for the pledge keepers.',
            })
            .catch(() => null);
          continue;
        }
        result.action = 'judged';
        const logs = parseLogs(IFACE, sent.logs).filter((p) => String(p.args.member).toLowerCase() === d.wallet.toLowerCase());
        for (const p of logs) {
          if (p.name === 'CycleJudged') {
            result.clean = Boolean(p.args.clean);
            result.missedInRow = Number(p.args.missedInRow);
          } else if (p.name === 'UnsecuredLimitHalved') {
            result.halved = true;
          }
        }
        // A second miss in a row leaves an unpaid cure amount: read it back rather than inferring it
        // from the events (one sync can judge several cycle ends). Already frozen before: not news.
        if (d.because !== 'frozen_cycle_end' && result.clean === false) {
          result.frozen = await deps.reader
            .cycleStateOf(d.wallet)
            .then((s) => BigInt(s.cureAmount) > 0n)
            .catch(() => false);
        }
        if (result.halved) {
          await deps
            .notify({
              wallet: d.wallet,
              title: 'Your cycle closed with a balance',
              body: 'Your income-backed and Boost limit is halved until you finish a cycle paid as due. Paying what was due this cycle restores it.',
              dedupeKey: `cycle-missed:${sent.hash}`,
              data: { txHash: sent.hash },
            })
            .catch(() => null);
        }
        if (result.frozen) {
          await deps
            .notify({
              wallet: d.wallet,
              title: 'Your line is paused: two cycles missed',
              body: 'Two cycles in a row closed without the amount due being paid, so your line is paused. Paying what was due reopens it.',
              dedupeKey: `cycle-frozen:${sent.hash}`,
              data: { txHash: sent.hash },
            })
            .catch(() => null);
          await deps
            .alert({
              key: `cycle-keeper:second-miss:${d.wallet}:${sent.hash}`,
              subject: `Second missed cycle: ${d.wallet}`,
              body:
                `${d.wallet} missed a second cycle in a row (syncCreditPeriod ${sent.hash}); the line is frozen. ` +
                'Default can only be computed after a cure-notice timestamp: proposeCureNotice then approveCureNotice by two different ATTESTER_ROLE signers, if Clear decides to send the notice.',
            })
            .catch(() => null);
        }
      } catch (error) {
        result.action = 'failed';
        result.reason = chainErrorReason(error).slice(0, 300);
      }
    }

    const failed = run.results.filter((r) => r.action === 'failed');
    if (failed.length) {
      for (const f of failed) console.error(`[cycle-keeper] ${f.call} ${f.wallet} failed: ${f.reason}`);
      await deps
        .alert({
          key: `cycle-keeper:failures:${hourKey(now)}`,
          subject: `Credit keeper: ${failed.length} call(s) not sent`,
          body:
            `Failed or unreadable: ${failed.map((f) => `${f.call} ${f.wallet} (${f.reason})`).join('; ')}. ` +
            'syncCreditPeriod and triggerDefault are permissionless and need only gas: check the card settler key has ETH, and the RPC. The next run retries.',
        })
        .catch(() => null);
    }
    return run;
  } finally {
    running = false;
  }
}

/* ---- Wiring ---- */

/**
 * The cycle keeper (syncCreditPeriod) has run since Phase 2b whenever it is configured, so it stays
 * on unless CYCLE_KEEPER_ENABLED=0. The default keeper (triggerDefault) is off unless
 * CREDIT_DEFAULT_KEEPER_ENABLED=1. Each takes `_DRY_RUN=1`.
 */
export const cycleSyncMode = (env: Record<string, string | undefined> = process.env) => keeperMode('CYCLE_KEEPER', env, true);
export const creditDefaultMode = (env: Record<string, string | undefined> = process.env) => keeperMode('CREDIT_DEFAULT_KEEPER', env);

export function isKeeperConfigured(): boolean {
  return Boolean(getContractAddress(keeperChainId(), 'RevolvingIssuer') && keeperKey() && getPostgresPool());
}

/** Whether the issuer judges cycles itself (Phase 2b). Before 2b the renewer rolls periods instead. */
export async function issuerJudgesCycles(): Promise<boolean> {
  const address = getContractAddress(keeperChainId(), 'RevolvingIssuer');
  if (!address) return false;
  try {
    await new ethers.Contract(address, KEEPER_ABI, chainProvider(keeperChainId())).creditTerms();
    return true;
  } catch {
    return false;
  }
}

/** Every member with a wallet on record, from the members database (not the Pay one). */
export async function memberWallets(): Promise<string[]> {
  const pool = getPostgresPool();
  if (!pool) return [];
  const { rows } = await pool.query<{ primary_wallet: string }>(
    `SELECT DISTINCT primary_wallet FROM members
      WHERE primary_wallet IS NOT NULL AND primary_wallet <> ''
      ORDER BY primary_wallet`,
  );
  return rows.map((r) => r.primary_wallet.toLowerCase());
}

export function keeperDeps(env: Record<string, string | undefined> = process.env): KeeperDeps | null {
  const chainId = keeperChainId(env);
  const address = getContractAddress(chainId, 'RevolvingIssuer');
  if (!address || !keeperKey(env)) return null;
  const reads = new ethers.Contract(address, KEEPER_ABI, chainProvider(chainId));
  return {
    issuer: address,
    reader: {
      creditPeriods: (m) => reads.creditPeriods(m),
      inCompliance: (m) => reads.inCompliance(m),
      inDefault: (m) => reads.inDefault(m),
      cycleStateOf: (m) => reads.cycleStateOf(m),
      totalDrawnOf: (m) => reads.totalDrawnOf(m),
    },
    runner: liveRunner(chainId, keeperKey(env)),
    syncMode: cycleSyncMode(env),
    defaultMode: creditDefaultMode(env),
    wallets: memberWallets,
    notify: (input) => notificationStore.emit({ ...input, kind: 'credit' }),
    alert: (input) => alertOps(input),
    maxPerRun: envCount('CYCLE_KEEPER_MAX_PER_RUN', DEFAULT_MAX_PER_RUN, env),
  };
}
