/*
 * Is the PayoutPool funded ahead of what it owes merchants?
 *
 * Decision 17 ended the PayoutPool borrowing for itself: Clear Lending funds merchant payouts ahead
 * of time, from its recorded Yield Pool Deployments or from BondVault excess withdrawn through the
 * Collateral Agent. Two rules say how far ahead:
 *
 *   - Compliance addendum 12.10: each financed charge is funded no later than two business days
 *     before the merchant's payout deadline.
 *   - The standing balance (decision 49): Clear Lending keeps the PayoutPool's payable balance at
 *     or above the claims due within the next 30 days.
 *
 * This module answers the question from chain reads and nothing else. It is shared by the API's
 * hourly keeper (jobs/payoutFundingKeeper.ts) and the Hardhat CLI (scripts/check_payout_funding.ts),
 * so it has no imports: the contracts are passed in as anything with the read methods below (an
 * ethers Contract built from the ABIs here is one), and everything after the reads is pure.
 *
 * Read-only by construction. Nothing here signs, sends or estimates a transaction; the funding
 * options it reports are information for whoever moves the money.
 *
 * Status:
 *   RED    an unpaid claim has reached its payout deadline, or the claims due within the next
 *          `deadlineBusinessDays` business days are more than the pool can pay (12.10 is breached).
 *   AMBER  the payable balance is below what is due within `standingDays` days (the standing
 *          balance is not kept); the top-up is exactly `dueWithin(standingDays).short`.
 *   GREEN  otherwise.
 *
 * Business days are weekdays in `timeZone` (default America/Los_Angeles, the calendar the
 * contracts use), less any dates in `holidays` (YYYY-MM-DD, in that zone). They are counted in
 * whole 24-hour steps from the moment in question: N business days after a moment is the same
 * time of day on the Nth later date that is a business day, and N business days before a deadline
 * is the same time of day on the Nth earlier one. "Due within 2 business days" means every claim
 * whose funding deadline (its payout deadline less 2 business days) has already arrived, so on a
 * weekend it runs to the end of the second business day after the last one.
 */

export const USDC_DECIMALS = 6;
const DAY = 86_400;
const WAD = 10n ** 18n;
/** The Yield Pool's utilization cap after a Deployment (`MAX_UTILIZATION`, 90%, FIXED). */
export const MAX_UTILIZATION = (9n * WAD) / 10n;

/* ========== ABIs (read-only fragments) ========== */

export const PAYOUT_POOL_READ_ABI = [
  'function dueWithin(uint256 horizon, uint256 maxClaims) view returns (uint256[] ids, uint256 amount, uint256 short)',
  'function held() view returns (uint256)',
  'function refundsOwed() view returns (uint256)',
  'function memberFunded() view returns (uint256)',
  'function treasuryAvailable() view returns (uint256)',
  'function nextUnpaid() view returns (uint256)',
  'function claimCount() view returns (uint256)',
  'function claimAt(uint256 claimId) view returns (address merchant, uint256 amount, uint64 claimedAt, uint64 dueBy, bool paid)',
] as const;

/** LendingPool (the Yield Pool). `deployedBalance` and `poolTierPrincipal` are served by its ledger module. */
export const YIELD_POOL_READ_ABI = [
  'function deployedBalance() view returns (uint256)',
  'function vaultCash() view returns (uint256)',
  'function poolTierPrincipal() view returns (uint256 value, uint256 postedAt)',
  'function queuedShares() view returns (uint256)',
  'function isSuspended() view returns (bool)',
  'function pendingLossCharge() view returns (bool pending, uint256 id, uint256 amount, uint256 absorbed, uint256 cursor, uint256 end)',
  'function finalMaturity() view returns (uint256)',
  'function deploymentAccount() view returns (address)',
] as const;

export const BOND_VAULT_READ_ABI = ['function deployableExcess() view returns (uint256)'] as const;

/* ========== CONFIG ========== */

export interface PayoutKeeperConfig {
  /** The standing-balance horizon, in calendar days. */
  standingDays: number;
  /** Addendum 12.10's lead time, in business days. */
  deadlineBusinessDays: number;
  /** At most this many claims are listed by each `dueWithin` read (and read one by one). */
  maxClaims: number;
  /** Dates that are not business days, YYYY-MM-DD in `timeZone`. */
  holidays: string[];
  /** The IANA zone business days are counted in. */
  timeZone: string;
}

export const DEFAULT_PAYOUT_KEEPER_CONFIG: PayoutKeeperConfig = {
  standingDays: 30,
  deadlineBusinessDays: 2,
  maxClaims: 200,
  holidays: [],
  timeZone: 'America/Los_Angeles',
};

function positiveInt(raw: string | undefined, fallback: number, allowZero = false): number {
  const n = Number((raw ?? '').trim());
  if (!(raw ?? '').trim() || !Number.isInteger(n) || n < 0 || (n === 0 && !allowZero)) return fallback;
  return n;
}

/**
 * The keeper's settings from the environment, shared by the API and the CLI:
 * PAYOUT_KEEPER_STANDING_DAYS (30), PAYOUT_KEEPER_DEADLINE_BUSINESS_DAYS (2),
 * PAYOUT_KEEPER_MAX_CLAIMS (200), PAYOUT_KEEPER_HOLIDAYS (comma-separated YYYY-MM-DD, none) and
 * PAYOUT_KEEPER_TIMEZONE (America/Los_Angeles). A value that does not parse keeps the default.
 */
export function payoutKeeperConfigFromEnv(env: Record<string, string | undefined>): PayoutKeeperConfig {
  const d = DEFAULT_PAYOUT_KEEPER_CONFIG;
  const holidays = (env.PAYOUT_KEEPER_HOLIDAYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  let timeZone = (env.PAYOUT_KEEPER_TIMEZONE ?? '').trim() || d.timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    timeZone = d.timeZone;
  }
  return {
    standingDays: positiveInt(env.PAYOUT_KEEPER_STANDING_DAYS, d.standingDays),
    deadlineBusinessDays: positiveInt(env.PAYOUT_KEEPER_DEADLINE_BUSINESS_DAYS, d.deadlineBusinessDays, true),
    maxClaims: positiveInt(env.PAYOUT_KEEPER_MAX_CLAIMS, d.maxClaims),
    holidays,
    timeZone,
  };
}

/* ========== BUSINESS DAYS ========== */

export interface BusinessCalendar {
  holidays: string[];
  timeZone: string;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The local date (YYYY-MM-DD), weekday (0 = Sunday) and seconds since local midnight of `unix`. */
export function localParts(unix: number, timeZone: string): { date: string; weekday: number; secondsOfDay: number } {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(unix * 1000))) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS[p.weekday] ?? 0,
    secondsOfDay: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second),
  };
}

export function isBusinessDay(unix: number, cal: BusinessCalendar): boolean {
  const { date, weekday } = localParts(unix, cal.timeZone);
  return weekday !== 0 && weekday !== 6 && !cal.holidays.includes(date);
}

/** No run of non-business days is longer than this; a holiday list that says otherwise is refused. */
const MAX_STEPS = 60;

function step(unix: number, n: number, direction: 1 | -1, cal: BusinessCalendar): number {
  let t = unix;
  let counted = 0;
  let steps = 0;
  while (counted < n) {
    t += direction * DAY;
    if (isBusinessDay(t, cal)) counted++;
    if (++steps > MAX_STEPS * Math.max(1, n)) throw new Error('No business day found: check PAYOUT_KEEPER_HOLIDAYS');
  }
  return t;
}

/** The same time of day on the `n`th later business day. */
export function addBusinessDays(unix: number, n: number, cal: BusinessCalendar): number {
  return step(unix, n, 1, cal);
}

/** The same time of day on the `n`th earlier business day: when a claim due at `unix` must be funded. */
export function subtractBusinessDays(unix: number, n: number, cal: BusinessCalendar): number {
  return step(unix, n, -1, cal);
}

/**
 * The latest deadline whose funding deadline (`subtractBusinessDays(deadline, n)`) has arrived by
 * `now`, as seconds from `now`: the horizon to pass to `dueWithin`.
 *
 * On a business day that is simply `n` business days on. On a weekend or holiday, the last funding
 * moment that has passed is the end of the last business day, so the horizon runs to the end of
 * the `n`th business day after that one: on a Saturday, claims due any time up to the end of
 * Tuesday should already have been funded (Tuesday's by Friday).
 */
export function deadlineHorizonSeconds(now: number, n: number, cal: BusinessCalendar): number {
  if (n <= 0) return 0;
  if (isBusinessDay(now, cal)) return addBusinessDays(now, n, cal) - now;
  const lastBusiness = subtractBusinessDays(now, 1, cal);
  const end = addBusinessDays(lastBusiness, n, cal);
  const { secondsOfDay } = localParts(end, cal.timeZone);
  return end - secondsOfDay + DAY - 1 - now;
}

/* ========== READS ========== */

export interface DueRead {
  ids: bigint[];
  amount: bigint;
  short: bigint;
}

export interface ClaimRead {
  id: bigint;
  amount: bigint;
  dueBy: number;
  paid: boolean;
}

export interface YieldPoolRead {
  deployedBalance: bigint;
  vaultCash: bigint;
  poolTierPrincipal: bigint;
  /** 0 until the Pool Tier principal is first posted; no Deployment is possible before it. */
  poolTierPostedAt: number;
  queuedShares: bigint;
  suspended: boolean;
  lossChargePending: boolean;
  /** 0 before the Initial Closing. */
  finalMaturity: number;
  deploymentAccount: string;
}

/** A read that may fail without stopping the check: the value, or why it is missing. */
export type Optional<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PayoutFundingReads {
  /** The chain's latest block timestamp. */
  now: number;
  held: bigint;
  /** `held` less refunds owed to members that their own money must cover (PayoutPool `_payable`). */
  payable: bigint;
  /** `dueWithin(0)`: claims at or past their payout deadline. */
  overdue: DueRead;
  /** `dueWithin(deadlineHorizon)`: claims whose 12.10 funding deadline has arrived. */
  deadline: DueRead;
  deadlineHorizon: number;
  /** `dueWithin(standingHorizon)`: the standing balance's 30 days. */
  standing: DueRead;
  standingHorizon: number;
  /** The claim paid next (`nextUnpaid`), or null with nothing queued. */
  head: ClaimRead | null;
  /** The claims listed in `standing` (and `overdue`), for when each has to be funded. Empty when GREEN. */
  claims: ClaimRead[];
  yieldPool: Optional<YieldPoolRead> | null;
  bondVaultExcess: Optional<bigint> | null;
  treasuryAvailable: Optional<bigint>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Read = (...args: any[]) => Promise<any>;
export interface PayoutPoolReader {
  dueWithin: Read;
  held: Read;
  refundsOwed: Read;
  memberFunded: Read;
  treasuryAvailable: Read;
  nextUnpaid: Read;
  claimCount: Read;
  claimAt: Read;
}
export interface YieldPoolReader {
  deployedBalance: Read;
  vaultCash: Read;
  poolTierPrincipal: Read;
  queuedShares: Read;
  isSuspended: Read;
  pendingLossCharge: Read;
  finalMaturity: Read;
  deploymentAccount: Read;
}
export interface BondVaultReader {
  deployableExcess: Read;
}

export interface PayoutFundingSource {
  /** The latest block's timestamp. */
  now: () => Promise<number>;
  payoutPool: PayoutPoolReader;
  /** Omitted or null where no Yield Pool is configured. */
  yieldPool?: YieldPoolReader | null;
  bondVault?: BondVaultReader | null;
}

function toDue(r: any): DueRead {
  return { ids: Array.from(r[0] as Iterable<unknown>, (id) => BigInt(id as bigint)), amount: BigInt(r[1]), short: BigInt(r[2]) };
}

function toClaim(id: bigint, r: any): ClaimRead {
  return { id, amount: BigInt(r[1]), dueBy: Number(r[3]), paid: Boolean(r[4]) };
}

function message(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string };
  return (e?.shortMessage || e?.message || String(error)).slice(0, 200);
}

async function optional<T>(read: () => Promise<T>): Promise<Optional<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

/**
 * Every read the check needs, as view calls. A PayoutPool read that fails fails the whole check
 * (there is no status without it); a Yield Pool, BondVault or treasury read that fails is reported
 * as unavailable, and the status is still given.
 */
export async function gatherPayoutFunding(source: PayoutFundingSource, config: PayoutKeeperConfig): Promise<PayoutFundingReads> {
  const pool = source.payoutPool;
  const now = await source.now();
  const deadlineHorizon = deadlineHorizonSeconds(now, config.deadlineBusinessDays, config);
  const standingHorizon = config.standingDays * DAY;
  const max = BigInt(config.maxClaims);

  const [overdue, deadline, standing, held, refundsOwed, memberFunded, nextUnpaid, claimCount, treasuryAvailable] =
    await Promise.all([
      pool.dueWithin(0n, max).then(toDue),
      pool.dueWithin(BigInt(deadlineHorizon), max).then(toDue),
      pool.dueWithin(BigInt(standingHorizon), max).then(toDue),
      pool.held().then(BigInt),
      pool.refundsOwed().then(BigInt),
      pool.memberFunded().then(BigInt),
      pool.nextUnpaid().then(BigInt),
      pool.claimCount().then(BigInt),
      optional(async () => BigInt(await pool.treasuryAvailable())),
    ]);

  const reserved = refundsOwed < memberFunded ? refundsOwed : memberFunded;
  const payable = held > reserved ? held - reserved : 0n;

  // One by one only when something is short or late: then the message says when each must be funded.
  const needDetail = overdue.ids.length > 0 || deadline.short > 0n || standing.short > 0n;
  const ids = needDetail ? [...new Set([...standing.ids, ...overdue.ids].map(String))].map(BigInt) : [];
  const [head, claims] = await Promise.all([
    nextUnpaid < claimCount ? pool.claimAt(nextUnpaid).then((r: any) => toClaim(nextUnpaid, r)) : Promise.resolve(null),
    Promise.all(ids.map((id) => pool.claimAt(id).then((r: any) => toClaim(id, r)))),
  ]);

  const yp = source.yieldPool;
  const bv = source.bondVault;
  const [yieldPool, bondVaultExcess] = await Promise.all([
    yp
      ? optional(async (): Promise<YieldPoolRead> => {
          const [deployedBalance, vaultCash, tier, queuedShares, suspended, charge, finalMaturity, deploymentAccount] =
            await Promise.all([
              yp.deployedBalance(),
              yp.vaultCash(),
              yp.poolTierPrincipal(),
              yp.queuedShares(),
              yp.isSuspended(),
              yp.pendingLossCharge(),
              yp.finalMaturity(),
              yp.deploymentAccount(),
            ]);
          return {
            deployedBalance: BigInt(deployedBalance),
            vaultCash: BigInt(vaultCash),
            poolTierPrincipal: BigInt(tier[0]),
            poolTierPostedAt: Number(tier[1]),
            queuedShares: BigInt(queuedShares),
            suspended: Boolean(suspended),
            lossChargePending: Boolean(charge[0]),
            finalMaturity: Number(finalMaturity),
            deploymentAccount: String(deploymentAccount),
          };
        })
      : Promise.resolve(null),
    bv ? optional(async () => BigInt(await bv.deployableExcess())) : Promise.resolve(null),
  ]);

  return {
    now,
    held,
    payable,
    overdue,
    deadline,
    deadlineHorizon,
    standing,
    standingHorizon,
    head,
    claims,
    yieldPool,
    bondVaultExcess,
    treasuryAvailable,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ========== FUNDING OPTIONS ========== */

export interface YieldPoolHeadroom {
  /** What one Deployment could draw now: the least of the three limits, or 0 while blocked. */
  headroom: bigint;
  /** Why no Deployment can be made at all; empty when one can. */
  blockedBy: string[];
  limits: {
    /** Vault Cash. */
    cash: bigint;
    /** What keeps Utilization at or below 90% afterwards. */
    utilizationCap: bigint;
    /** The posted Pool Tier principal less the Deployed Balance. */
    poolTier: bigint;
  };
  /** Which limit sets `headroom` when nothing blocks it. */
  binding: 'cash' | 'utilization cap' | 'Pool Tier principal' | null;
}

/**
 * What a Deployment could draw now, under the checks `YieldPoolValuation.deploy` makes: no open
 * queue request, no Suspension, no pending loss charge, before Final Maturity, a deployment account
 * set; at most Vault Cash; Utilization afterwards at most 90%, (D + x) / (D + cash) <= 0.9, so
 * x <= 0.9 (D + cash) - D; and the Deployed Balance afterwards at most the posted Pool Tier
 * principal (none before it is posted). Rounded down, so the amount always passes the cap check.
 */
export function yieldPoolHeadroom(read: YieldPoolRead, now: number): YieldPoolHeadroom {
  const D = read.deployedBalance;
  const cash = read.vaultCash;
  const blockedBy: string[] = [];
  if (read.suspended) blockedBy.push('suspended');
  if (read.queuedShares > 0n) blockedBy.push('withdrawal queue open');
  if (read.lossChargePending) blockedBy.push('loss charge pending');
  if (read.finalMaturity !== 0 && now >= read.finalMaturity) blockedBy.push('past Final Maturity');
  if (!read.deploymentAccount || /^0x0{40}$/i.test(read.deploymentAccount)) blockedBy.push('no deployment account set');
  if (read.poolTierPostedAt === 0) blockedBy.push('no Pool Tier principal posted');

  const maxDeployed = ((D + cash) * MAX_UTILIZATION) / WAD;
  const utilizationCap = maxDeployed > D ? maxDeployed - D : 0n;
  const poolTier = read.poolTierPostedAt === 0 ? 0n : read.poolTierPrincipal > D ? read.poolTierPrincipal - D : 0n;
  const limits = { cash, utilizationCap, poolTier };

  if (blockedBy.length) return { headroom: 0n, blockedBy, limits, binding: null };
  let headroom = cash;
  let binding: YieldPoolHeadroom['binding'] = 'cash';
  if (utilizationCap < headroom) {
    headroom = utilizationCap;
    binding = 'utilization cap';
  }
  if (poolTier < headroom) {
    headroom = poolTier;
    binding = 'Pool Tier principal';
  }
  return { headroom, blockedBy, limits, binding };
}

export interface FundingOptions {
  /** Null when no Yield Pool is configured. */
  yieldPool: Optional<YieldPoolHeadroom> | null;
  /** BondVault `deployableExcess()`, withdrawn through the Collateral Agent. Null when not configured. */
  bondVaultExcess: Optional<bigint> | null;
  /** PayoutPool `treasuryAvailable()`: the co-op treasury's allowance to the pool, capped at its balance. */
  treasuryAvailable: Optional<bigint>;
  /** The sum of what was read. */
  total: bigint;
}

export function fundingOptions(reads: PayoutFundingReads): FundingOptions {
  const yieldPool: FundingOptions['yieldPool'] =
    reads.yieldPool === null
      ? null
      : reads.yieldPool.ok
        ? { ok: true, value: yieldPoolHeadroom(reads.yieldPool.value, reads.now) }
        : reads.yieldPool;
  let total = 0n;
  if (yieldPool?.ok) total += yieldPool.value.headroom;
  if (reads.bondVaultExcess?.ok) total += reads.bondVaultExcess.value;
  if (reads.treasuryAvailable.ok) total += reads.treasuryAvailable.value;
  return { yieldPool, bondVaultExcess: reads.bondVaultExcess, treasuryAvailable: reads.treasuryAvailable, total };
}

/* ========== STATUS ========== */

export type PayoutFundingLevel = 'GREEN' | 'AMBER' | 'RED';

export interface DueSummary {
  horizonSeconds: number;
  /** now + horizon. */
  until: number;
  count: number;
  amount: bigint;
  short: bigint;
  /** `maxClaims` were listed, so there may be more: amount and short are then lower bounds. */
  truncated: boolean;
}

export interface PayoutFundingStatus {
  level: PayoutFundingLevel;
  /** One line per condition found, worst first. Empty when GREEN. */
  reasons: string[];
  now: number;
  held: bigint;
  payable: bigint;
  overdue: { ids: bigint[]; amount: bigint; short: bigint; earliestDueBy: number | null; truncated: boolean };
  deadline: DueSummary;
  standing: DueSummary;
  /** The cash to add now: what the overdue claims and the claims inside 12.10's deadline lack. 0 unless RED. */
  neededNow: bigint;
  /** The top-up that restores the standing balance: `dueWithin(standingDays).short`. */
  topUp: bigint;
  /** When the top-up (or its first part) must arrive: now when RED, else the funding deadline of the first claim the pool cannot pay. */
  fundBy: number | null;
  /** The first claim, in deadline order, that the payable balance does not reach. */
  firstUnfunded: ClaimRead | null;
  /** An overdue claim the pool could already pay: nothing is short, `payNext()` just has not been called. */
  payableNow: boolean;
  options: FundingOptions;
  config: PayoutKeeperConfig;
}

function summary(read: DueRead, horizon: number, now: number, max: number): DueSummary {
  return {
    horizonSeconds: horizon,
    until: now + horizon,
    count: read.ids.length,
    amount: read.amount,
    short: read.short,
    truncated: read.ids.length >= max,
  };
}

/** Claims in the order the pool pays them: deadline first, then the older claim. */
function byDeadline(a: ClaimRead, b: ClaimRead): number {
  if (a.dueBy !== b.dueBy) return a.dueBy - b.dueBy;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The status, from the reads. Pure: no clock but `reads.now`, no I/O. */
export function evaluatePayoutFunding(reads: PayoutFundingReads, config: PayoutKeeperConfig): PayoutFundingStatus {
  const { now } = reads;
  const max = config.maxClaims;
  const unpaid = reads.claims.filter((c) => !c.paid).sort(byDeadline);

  // Overdue: listed by dueWithin(0), or the head itself if a long queue cut the list short.
  const overdueIds = [...reads.overdue.ids];
  const head = reads.head && !reads.head.paid ? reads.head : null;
  if (head && head.dueBy <= now && !overdueIds.includes(head.id)) overdueIds.push(head.id);
  const overdueClaims = unpaid.filter((c) => c.dueBy <= now);
  const earliestDueBy =
    head && head.dueBy <= now ? head.dueBy : overdueClaims.length ? overdueClaims[0].dueBy : null;
  const overdueAmount = reads.overdue.amount > 0n ? reads.overdue.amount : head && head.dueBy <= now ? head.amount : 0n;
  const overdueShort =
    reads.overdue.short > 0n ? reads.overdue.short : overdueAmount > reads.payable ? overdueAmount - reads.payable : 0n;

  const deadline = summary(reads.deadline, reads.deadlineHorizon, now, max);
  const standing = summary(reads.standing, reads.standingHorizon, now, max);

  // The first claim the payable balance does not reach, in the order the pool pays.
  let firstUnfunded: ClaimRead | null = null;
  let running = 0n;
  for (const c of unpaid) {
    running += c.amount;
    if (running > reads.payable) {
      firstUnfunded = c;
      break;
    }
  }

  const reasons: string[] = [];
  let level: PayoutFundingLevel = 'GREEN';
  const isOverdue = overdueIds.length > 0;
  if (isOverdue) {
    level = 'RED';
    reasons.push(
      `${overdueIds.length}${reads.overdue.ids.length >= max ? '+' : ''} claim(s) totalling ${formatUsdc(overdueAmount)} have reached their payout deadline unpaid` +
        (overdueShort > 0n ? `; the pool lacks ${formatUsdc(overdueShort, 'up')} to pay them` : '; the pool holds enough, so `payNext()` (permissionless) only needs calling'),
    );
  }
  if (deadline.short > 0n) {
    level = 'RED';
    reasons.push(
      `claims due within ${config.deadlineBusinessDays} business days (${formatUsdc(deadline.amount)}) are short ${formatUsdc(deadline.short, 'up')}: addendum 12.10's funding deadline has passed for them`,
    );
  }
  if (standing.short > 0n) {
    if (level === 'GREEN') level = 'AMBER';
    reasons.push(
      `the payable balance (${formatUsdc(reads.payable)}) is below the ${formatUsdc(standing.amount)} due within ${config.standingDays} days: top up ${formatUsdc(standing.short, 'up')} to keep the standing balance`,
    );
  }
  const truncatedNote = [reads.overdue, reads.deadline, reads.standing].some((d) => d.ids.length >= max);
  if (level !== 'GREEN' && truncatedNote) {
    reasons.push(`more than ${max} claims are due: amounts are lower bounds (raise PAYOUT_KEEPER_MAX_CLAIMS)`);
  }

  const neededNow = level === 'RED' ? (deadline.short > overdueShort ? deadline.short : overdueShort) : 0n;
  let fundBy: number | null = null;
  if (level === 'RED') fundBy = now;
  else if (level === 'AMBER') {
    fundBy = firstUnfunded ? subtractBusinessDays(firstUnfunded.dueBy, config.deadlineBusinessDays, config) : null;
    if (fundBy !== null && fundBy < now) fundBy = now;
  }

  return {
    level,
    reasons,
    now,
    held: reads.held,
    payable: reads.payable,
    overdue: { ids: overdueIds, amount: overdueAmount, short: overdueShort, earliestDueBy, truncated: reads.overdue.ids.length >= max },
    deadline,
    standing,
    neededNow,
    topUp: standing.short,
    fundBy,
    firstUnfunded,
    payableNow: isOverdue && overdueShort === 0n,
    options: fundingOptions(reads),
    config,
  };
}

/* ========== TEXT ========== */

/** USDC (6 decimals) as dollars and cents. Amounts needed round up, amounts available round down. */
export function formatUsdc(units: bigint, round: 'up' | 'down' = 'down'): string {
  const negative = units < 0n;
  let v = negative ? -units : units;
  const step = 10n ** BigInt(USDC_DECIMALS - 2);
  const rem = v % step;
  v = v - rem + (round === 'up' && rem > 0n ? step : 0n);
  const cents = v / step;
  const dollars = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${dollars}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export function formatTime(unix: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(new Date(unix * 1000));
}

function optionLine<T>(label: string, read: Optional<T> | null, show: (v: T) => string): string {
  if (read === null) return `- ${label}: not configured`;
  if (!read.ok) return `- ${label}: unavailable (read failed: ${read.error})`;
  return `- ${label}: ${show(read.value)}`;
}

/** The funding options as lines of text, the same for the alert and the CLI. */
export function describeOptions(options: FundingOptions): string[] {
  return [
    optionLine('Yield Pool Deployment headroom', options.yieldPool, (h) =>
      h.blockedBy.length
        ? `${formatUsdc(0n)} (blocked: ${h.blockedBy.join(', ')})`
        : `${formatUsdc(h.headroom)} (limited by ${h.binding}; cash ${formatUsdc(h.limits.cash)}, 90% cap ${formatUsdc(h.limits.utilizationCap)}, Pool Tier ${formatUsdc(h.limits.poolTier)})`,
    ),
    optionLine('BondVault deployable excess (through the Collateral Agent)', options.bondVaultExcess, (v) => formatUsdc(v)),
    optionLine('Co-op treasury allowance to PayoutPool (treasuryAvailable)', options.treasuryAvailable, (v) => formatUsdc(v)),
    `- Together: ${formatUsdc(options.total)}`,
  ];
}

/** A subject and body for the status: what is needed, by when, and from where it could come. */
export function describePayoutFunding(
  status: PayoutFundingStatus,
  context: { chain: string; payoutPool: string },
): { subject: string; body: string } {
  const tz = status.config.timeZone;
  const lines: string[] = [];
  let subject: string;
  if (status.level === 'RED') {
    subject = status.neededNow > 0n
      ? `Payout funding RED: ${formatUsdc(status.neededNow, 'up')} needed now`
      : 'Payout funding RED: a claim is past its deadline (payNext not called)';
  } else if (status.level === 'AMBER') {
    subject = `Payout funding AMBER: top up ${formatUsdc(status.topUp, 'up')}${status.fundBy ? ` by ${formatTime(status.fundBy, tz)}` : ''}`;
  } else {
    subject = 'Payout funding GREEN';
  }

  lines.push(`PayoutPool ${context.payoutPool} on ${context.chain}: ${status.level}, checked ${formatTime(status.now, tz)}.`);
  if (status.reasons.length) {
    lines.push('', 'Why:');
    for (const r of status.reasons) lines.push(`- ${r}`);
  }

  lines.push('', 'Needed:');
  if (status.level === 'RED') {
    lines.push(`- Now: ${formatUsdc(status.neededNow, 'up')} (addendum 12.10: each financed charge is funded no later than ${status.config.deadlineBusinessDays} business days before the merchant's payout deadline).`);
    if (status.overdue.earliestDueBy !== null) lines.push(`- Earliest missed payout deadline: ${formatTime(status.overdue.earliestDueBy, tz)}.`);
    if (status.payableNow) lines.push('- The pool already holds the cash for the overdue claims: anyone may call `payNext()` or `payQueue(n)`.');
  }
  if (status.topUp > 0n) {
    lines.push(
      `- Standing balance: ${formatUsdc(status.topUp, 'up')} brings the payable balance up to the ${formatUsdc(status.standing.amount)} due within ${status.config.standingDays} days.`,
    );
    if (status.level === 'AMBER' && status.fundBy !== null && status.firstUnfunded) {
      lines.push(
        `- By ${formatTime(status.fundBy, tz)} at the latest: claim #${status.firstUnfunded.id} then reaches its addendum 12.10 funding deadline and this turns RED.`,
      );
    }
  }
  if (status.firstUnfunded) {
    const c = status.firstUnfunded;
    lines.push(`- First claim the pool cannot pay: #${c.id} (${formatUsdc(c.amount)}), payout deadline ${formatTime(c.dueBy, tz)}.`);
  }
  if (status.level === 'GREEN') lines.push('- Nothing: the payable balance covers everything due within the horizons.');

  lines.push(
    '',
    'Balances:',
    `- Payable: ${formatUsdc(status.payable)} (held ${formatUsdc(status.held)}, less refunds owed to members)`,
    `- Due within ${status.config.deadlineBusinessDays} business days (to ${formatTime(status.deadline.until, tz)}): ${formatUsdc(status.deadline.amount)} in ${status.deadline.count}${status.deadline.truncated ? '+' : ''} claim(s), short ${formatUsdc(status.deadline.short, 'up')}`,
    `- Due within ${status.config.standingDays} days (to ${formatTime(status.standing.until, tz)}): ${formatUsdc(status.standing.amount)} in ${status.standing.count}${status.standing.truncated ? '+' : ''} claim(s), short ${formatUsdc(status.standing.short, 'up')}`,
    '',
    'Funding options (information only; nothing has been moved):',
    ...describeOptions(status.options),
  );
  return { subject, body: lines.join('\n') };
}
