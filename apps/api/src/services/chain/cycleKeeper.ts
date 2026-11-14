import { ethers } from 'ethers';
import { getPostgresPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from './provider.js';
import { chainErrorReason } from './chainErrors.js';
import { notificationStore } from '../notificationStore.js';
import { alertOps } from '../opsAlert.js';

/*
 * The cycle keeper (Phase 2b, section 12.4-12.5).
 *
 * RevolvingIssuer judges a cycle lazily: Clean, missed (the unsecured limit halves), cure notice, or
 * default is recorded only when the member transacts or someone calls `syncCreditPeriod(member)`.
 * That call is permissionless and needs no role, only gas. A member nobody syncs earns no Clean
 * Cycles (so never the higher Boost cap) and is never halved or noticed either. This keeper syncs
 * each member once their cycle is ready to be judged, from a key the API already pays gas with (the
 * card settler's).
 *
 * When a cycle is ready (all read from chain):
 *   - the grace window has ended (`now >= expiration + graceLength`): judged Clean or missed;
 *   - or the period has expired and the line is already rebalanced (`inCompliance`): the contract
 *     judges that Clean straight away (`isFrozen` is false), so it is not left waiting out the grace;
 *   - a second miss leaves the period expired with a dated cure notice; it is synced again only once
 *     the cure window has passed (`cureNoticeAt + cureWindow`), which is when default is recorded.
 * A judged cycle rolls the period (a new expiration in the future), so the next run skips it: the
 * keeper is idempotent and safe to rerun, and never syncs a member twice for one cycle. Each run is
 * bounded (oldest due first) and runs never overlap.
 *
 * What the judgement did is read from the receipt (`CycleJudged`, `UnsecuredLimitHalved`,
 * `CureNotice`) and the member is told about a missed cycle or a cure notice. Failures are logged and
 * alerted.
 */

export const KEEPER_ABI = [
  'function creditPeriods(address member) view returns (uint256 issuedAt, uint256 expiration, uint256 graceLength, bool paused)',
  'function inCompliance(address member) view returns (bool)',
  'function cycleOf(address) view returns (uint8 missedInRow, uint8 cleanStreak, uint8 depositBits, uint64 cureNoticeAt, uint128 unsecuredCeiling)',
  'function creditTerms() view returns (uint128 unsecuredLineCap, uint64 cureWindow, uint8 boostCleanCycles, uint8 boostDepositCycles, bool autoClearOffGlobal)',
  'function syncCreditPeriod(address member) returns (bool)',
  'event CycleJudged(address indexed member, bool clean, uint8 missedInRow, uint8 cleanStreak, bool deposited)',
  'event UnsecuredLimitHalved(address indexed member, uint256 newLimit, uint256 excess)',
  'event CureNotice(address indexed member, uint64 noticeAt, uint64 defaultFrom)',
];
const EVENTS = new ethers.Interface(KEEPER_ABI);

/** Members synced per run, at most. A backlog drains oldest first over the next runs. */
export const DEFAULT_MAX_PER_RUN = 50;

export interface KeeperReader {
  creditPeriods(member: string): Promise<[bigint, bigint, bigint, boolean] | readonly unknown[]>;
  inCompliance(member: string): Promise<boolean>;
  cycleOf(member: string): Promise<{ missedInRow: bigint | number; cureNoticeAt: bigint | number }>;
  creditTerms(): Promise<{ cureWindow: bigint | number }>;
}

export interface KeeperWriter {
  syncCreditPeriod(member: string): Promise<{ hash: string; wait: (confirms?: number) => Promise<{ logs: ReadonlyArray<{ topics: ReadonlyArray<string>; data: string }> } | null> }>;
}

export interface KeeperDeps {
  reader: KeeperReader;
  writer: KeeperWriter;
  wallets: () => Promise<string[]>;
  notify: (input: { wallet: string; title: string; body: string; dedupeKey: string; data: Record<string, unknown> }) => Promise<unknown>;
  alert: (input: { key: string; subject: string; body: string }) => Promise<unknown>;
  now?: number;
  maxPerRun?: number;
}

export interface KeeperResult {
  wallet: string;
  action: 'judged' | 'failed';
  /** Why it was due: the grace ended, the line was already clean, or the cure window passed. */
  because: 'grace_ended' | 'clean' | 'cure_window_passed';
  clean?: boolean;
  missedInRow?: number;
  halved?: boolean;
  cureNotice?: boolean;
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

interface Due {
  wallet: string;
  since: number;
  because: KeeperResult['because'];
}

/**
 * Whether this member's cycle is ready to be judged now, and since when. Null when it is not: no
 * line, paused, the period still running, still inside the grace with a balance, or a cure notice
 * whose window is still open.
 */
export async function dueFor(reader: KeeperReader, wallet: string, now: number, cureWindow: number): Promise<Due | null> {
  const [issuedAt, expiration, graceLength, paused] = (await reader.creditPeriods(wallet)) as [bigint, bigint, bigint, boolean];
  if (Number(issuedAt) === 0 || Number(expiration) === 0 || paused) return null;
  const expiresAt = Number(expiration);
  if (now < expiresAt) return null;
  const graceEnds = expiresAt + Number(graceLength);

  // A second miss in a row keeps the period expired with a dated cure notice. Sync it again only
  // when the cure window has passed: that is the judgement that records default.
  const cycle = await reader.cycleOf(wallet);
  const noticeAt = Number(cycle.cureNoticeAt);
  if (noticeAt > 0) {
    const defaultFrom = noticeAt + cureWindow;
    return now >= defaultFrom ? { wallet, since: defaultFrom, because: 'cure_window_passed' } : null;
  }
  if (now >= graceEnds) return { wallet, since: graceEnds, because: 'grace_ended' };
  // Expired, inside the grace: judged straight away if already rebalanced (a Clean Cycle).
  return (await reader.inCompliance(wallet)) ? { wallet, since: expiresAt, because: 'clean' } : null;
}

let running = false;

/** One pass: find every member whose cycle is ready, oldest first, and sync up to the bound. */
export async function runCycleKeeper(deps: KeeperDeps): Promise<KeeperRun> {
  const run: KeeperRun = { checked: 0, due: 0, results: [], deferred: 0 };
  if (running) return run; // never two passes at once: a sync in flight would be sent twice
  running = true;
  try {
    const now = deps.now ?? Math.floor(Date.now() / 1000);
    const max = deps.maxPerRun ?? DEFAULT_MAX_PER_RUN;
    const cureWindow = Number((await deps.reader.creditTerms()).cureWindow);
    const wallets = await deps.wallets();
    const due: Due[] = [];
    for (const wallet of wallets) {
      run.checked += 1;
      try {
        const d = await dueFor(deps.reader, wallet, now, cureWindow);
        if (d) due.push(d);
      } catch (error) {
        run.results.push({ wallet, action: 'failed', because: 'grace_ended', reason: `read: ${chainErrorReason(error)}` });
      }
    }
    due.sort((a, b) => a.since - b.since);
    run.due = due.length;
    run.deferred = Math.max(0, due.length - max);

    for (const d of due.slice(0, max)) {
      try {
        const tx = await deps.writer.syncCreditPeriod(d.wallet);
        const receipt = await tx.wait(1);
        const result: KeeperResult = { wallet: d.wallet, action: 'judged', because: d.because, txHash: tx.hash };
        let defaultFrom: number | null = null;
        for (const log of receipt?.logs ?? []) {
          let parsed: ethers.LogDescription | null = null;
          try {
            parsed = EVENTS.parseLog({ topics: [...log.topics], data: log.data });
          } catch {
            continue;
          }
          if (!parsed || String(parsed.args.member).toLowerCase() !== d.wallet.toLowerCase()) continue;
          if (parsed.name === 'CycleJudged') {
            result.clean = Boolean(parsed.args.clean);
            result.missedInRow = Number(parsed.args.missedInRow);
          } else if (parsed.name === 'UnsecuredLimitHalved') {
            result.halved = true;
          } else if (parsed.name === 'CureNotice') {
            result.cureNotice = true;
            defaultFrom = Number(parsed.args.defaultFrom);
          }
        }
        if (result.halved) {
          await deps
            .notify({
              wallet: d.wallet,
              title: 'Your cycle closed with a balance',
              body: 'Your income-backed and Boost limit is halved until you finish a cycle at zero. Clearing your balance this cycle restores it.',
              dedupeKey: `cycle-missed:${tx.hash}`,
              data: { txHash: tx.hash },
            })
            .catch(() => null);
        }
        if (result.cureNotice) {
          const by = defaultFrom ? new Date(defaultFrom * 1000).toISOString().slice(0, 10) : 'the date in your notice';
          await deps
            .notify({
              wallet: d.wallet,
              title: 'Cure notice: two cycles missed',
              body: `Your line is paused. Clear your balance by ${by} to avoid default.`,
              dedupeKey: `cure-notice:${tx.hash}`,
              data: { txHash: tx.hash, defaultFrom },
            })
            .catch(() => null);
        }
        run.results.push(result);
      } catch (error) {
        run.results.push({ wallet: d.wallet, action: 'failed', because: d.because, reason: chainErrorReason(error).slice(0, 300) });
      }
    }

    const failed = run.results.filter((r) => r.action === 'failed');
    if (failed.length) {
      for (const f of failed) console.error(`[cycle-keeper] ${f.wallet} failed: ${f.reason}`);
      await deps
        .alert({
          key: `cycle-keeper:failures:${new Date(now * 1000).toISOString().slice(0, 13)}`,
          subject: `Cycle keeper: ${failed.length} member(s) not synced`,
          body:
            `syncCreditPeriod failed or could not be read for: ${failed.map((f) => `${f.wallet} (${f.reason})`).join('; ')}. ` +
            'It is permissionless and needs only gas: check the card settler key has ETH, and the RPC. The next run retries.',
        })
        .catch(() => null);
    }
    return run;
  } finally {
    running = false;
  }
}

/* ---- Wiring ---- */

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

/** The key that pays the keeper's gas: the card settler, which already writes to the RevolvingIssuer. */
const keeperKey = () => (process.env.CARD_SETTLER_PRIVATE_KEY || '').trim();

export function isKeeperConfigured(): boolean {
  return Boolean(getContractAddress(chainId(), 'RevolvingIssuer') && keeperKey() && getPostgresPool());
}

/** Whether the issuer judges cycles itself (Phase 2b). Before 2b the renewer rolls periods instead. */
export async function issuerJudgesCycles(): Promise<boolean> {
  const address = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!address) return false;
  try {
    await new ethers.Contract(address, KEEPER_ABI, chainProvider(chainId())).creditTerms();
    return true;
  } catch {
    return false;
  }
}

/** Every member with a wallet on record, from the members database (not the Pay one). */
async function memberWallets(): Promise<string[]> {
  const pool = getPostgresPool();
  if (!pool) return [];
  const { rows } = await pool.query<{ primary_wallet: string }>(
    `SELECT DISTINCT primary_wallet FROM members
      WHERE primary_wallet IS NOT NULL AND primary_wallet <> ''
      ORDER BY primary_wallet`,
  );
  return rows.map((r) => r.primary_wallet.toLowerCase());
}

export function keeperDeps(): KeeperDeps | null {
  const address = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!address || !keeperKey()) return null;
  const provider = chainProvider(chainId());
  const signer = new ethers.Wallet(keeperKey(), provider);
  const maxPerRun = Number(process.env.CYCLE_KEEPER_MAX_PER_RUN || DEFAULT_MAX_PER_RUN);
  return {
    reader: new ethers.Contract(address, KEEPER_ABI, provider) as unknown as KeeperReader,
    writer: new ethers.Contract(address, KEEPER_ABI, writesAs(signer)) as unknown as KeeperWriter,
    wallets: memberWallets,
    notify: (input) => notificationStore.emit({ ...input, kind: 'credit' }),
    alert: (input) => alertOps(input),
    maxPerRun: Number.isFinite(maxPerRun) && maxPerRun > 0 ? maxPerRun : DEFAULT_MAX_PER_RUN,
  };
}
