/*
 * The Assurance fee arithmetic, pure (IV-03 8.3, 8.7 and 7.5 Step 5). Amounts are USDC base units as
 * bigint; nothing here rounds up.
 *
 * The Credit Enhancement Fee is a commitment fee of 8% a year on average daily Available Coverage,
 * actual/365: for a month, fee = Σ(each day's availableCoverage) × bps / 10,000 / 365, rounded down
 * once. A leap year is not special: a year is 365 days, and February 29th is one more day of fee. A
 * day with no reading counts as zero (the pool did not exist, or was not yet watched).
 */

export const DAYS_PER_YEAR = 365n;
export const BPS = 10_000n;

/** "2026-11": the month a day falls in. */
export const monthOf = (day: string) => day.slice(0, 7);

/** The first day of a month, as the database keeps it: "2026-11-01". */
export const monthStart = (month: string) => `${month}-01`;

/** How many days a month has (UTC calendar). */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Every day of a month, "2026-11-01" … "2026-11-30". */
export function daysOf(month: string): string[] {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** The UTC day of a time: "2026-11-17". */
export const utcDay = (t: Date | number) => new Date(t).toISOString().slice(0, 10);

/** The day after (or `n` after) a UTC day. */
export function addDays(day: string, n = 1): string {
  return utcDay(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000);
}

/** The month before. */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The month after. */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Σ coverage × bps / 10,000 / 365, rounded down once. */
export function feeOn(sum: bigint, bps: bigint): bigint {
  if (sum < 0n || bps < 0n) throw new Error('A fee is never on a negative balance or rate');
  return (sum * bps) / (BPS * DAYS_PER_YEAR);
}

export interface FeeBasis {
  month: string;
  /** Calendar days in the month: the average is over all of them. */
  days: number;
  /** Days with a reading (some may be filled). */
  read: number;
  /** Days filled by a later run with the value read then. */
  filled: number;
  /** Days with no reading at all: counted as zero. */
  zero: number;
  /** Σ daily availableCoverage, base units. */
  sum: string;
  /** Average daily availableCoverage over the month, rounded down. */
  average: string;
  bps: number;
  fee: string;
}

/**
 * A month's fee from its daily readings (day → coverage; `filled` marks the days read late). Days
 * outside the month are ignored, and days missing from the map count as zero.
 */
export function monthFee(month: string, daily: Map<string, { coverage: bigint; filled?: boolean }>, bps: bigint): FeeBasis {
  const days = daysOf(month);
  let sum = 0n;
  let read = 0;
  let filled = 0;
  for (const d of days) {
    const r = daily.get(d);
    if (!r) continue;
    if (r.coverage < 0n) throw new Error(`A negative coverage reading for ${d}`);
    sum += r.coverage;
    read += 1;
    if (r.filled) filled += 1;
  }
  return {
    month,
    days: days.length,
    read,
    filled,
    zero: days.length - read,
    sum: sum.toString(),
    average: (sum / BigInt(days.length)).toString(),
    bps: Number(bps),
    fee: feeOn(sum, bps).toString(),
  };
}

/** The co-op's interchange contribution: interchange × bps / 10,000, rounded down. */
export function interchangeShare(interchange: bigint, bps: bigint): bigint {
  if (interchange < 0n) throw new Error('Interchange is never negative');
  return (interchange * bps) / BPS;
}

/**
 * Advances outstanding (8.7): every draw released to Clear Lending, less what has been paid back
 * into the Credit Backstop as Spread Repayments and recoveries. Never below zero.
 */
export function advancesOutstanding(released: bigint, repaid: bigint): bigint {
  return released > repaid ? released - repaid : 0n;
}

/** "$1,234.56" from base units, for messages. Rounds down to the cent. */
export function usd(units: bigint | string): string {
  const v = BigInt(units);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const dollars = (a / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = ((a % 1_000_000n) / 10_000n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}$${dollars}.${cents}`;
}

/** Whole dollars and cents typed by a person, to base units: "12.34" → 12_340_000n. Refuses more than 6 decimals. */
export function toUnits(amount: number | string): bigint {
  const s = typeof amount === 'number' ? amount.toFixed(6) : amount.trim();
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw new Error(`“${s}” isn’t an amount of USDC`);
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
}
