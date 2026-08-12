/**
 * The member app's money model — design spec §3, "Core display rules".
 *
 * These are product decisions, not styling, so they live in one place rather than
 * being re-derived per page. Components should read these helpers instead of doing
 * their own arithmetic on balances.
 */

export type TierKey = 'savings' | 'asset' | 'income' | 'boost';

export interface CreditTier {
  key: TierKey;
  /** Row label, e.g. "Savings (CLRUSD)". */
  label: string;
  /** Short label for narrow layouts, e.g. "Savings". */
  shortLabel?: string;
  /** Cost of carrying a balance on this tier, e.g. "free", "1.5% / cycle". */
  rate: string;
  used: number;
  /** What this tier can back. Not the same as the cycle limit. */
  limit: number;
  /** Boost is opt-in; an unadded tier renders dimmed and lends nothing. */
  added: boolean;
}

export interface Credit {
  tiers: CreditTier[];
  /**
   * How much credit can be drawn this cycle. Fixed within the cycle (rule 3) —
   * only `used` moves in realtime. This is the denominator for the credit bar and
   * for "available to spend"; it is NOT the sum of the tier limits, which is what
   * backs the limit (see LimitBacking).
   */
  cycleLimit: number;
  /** Interest accrued so far this cycle. */
  carryCost: number;
  /** Carry cost drops to zero back under this figure. */
  carryFreeUnder: number;
}

export interface Cycle {
  lengthDays: number;
  daysLeft: number;
  /** e.g. "Nov 1 payday". */
  clearsOn: string;
}

export interface Savings {
  cash: number;
  vested: number;
  vesting: number;
  credits: number;
  creditsGoal: number;
}

export interface CashAccount {
  balance: number;
  nextDepositOn: string;
  nextDepositEstimate: number;
  directDepositActive: boolean;
}

export interface SetupTask {
  id: string;
  label: string;
  /** Button label when this task is the one being nudged. */
  cta?: string;
  done: boolean;
}

export interface ActivityRow {
  id: string;
  name: string;
  date: string;
  /** Where the money moved from — spec §8 requires this on every row. */
  source: 'credit' | 'cash' | 'savings' | 'cash account' | 'pending';
  /** Negative debits, positive credits. */
  amount: number;
}

export interface LimitBackingRow {
  label: string;
  /** What this position contributes to the limit. */
  contribution: number;
  /** "$6,895 value today · 95% · 0.65%" */
  detail: string;
  tier: TierKey;
  /** Opt-in and not taken up yet — renders dimmed. */
  dimmed?: boolean;
}

export interface LimitBacking {
  assetBacked: LimitBackingRow[];
  unsecured: LimitBackingRow[];
}

export interface HomeData {
  cash: number;
  credit: Credit;
  cycle: Cycle;
  savings: Savings;
  cashAccount: CashAccount;
  tasks: SetupTask[];
  recent: ActivityRow[];
  backing: LimitBacking;
}

/** Tiers are drawn cheapest-first, automatically (rule 7). */
export const TIER_ORDER: TierKey[] = ['savings', 'asset', 'income', 'boost'];

export function orderedTiers(tiers: CreditTier[]): CreditTier[] {
  return [...tiers].sort((a, b) => TIER_ORDER.indexOf(a.key) - TIER_ORDER.indexOf(b.key));
}

/** Total credit drawn across every tier. */
export function creditUsed(credit: Credit): number {
  return credit.tiers.reduce((sum, t) => sum + t.used, 0);
}

/** Credit still available this cycle. Never negative. */
export function creditLeft(credit: Credit): number {
  return Math.max(0, credit.cycleLimit - creditUsed(credit));
}

/**
 * available = cash + (limit − used) — rule 2. Cash spends first; credit engages
 * only once cash hits zero. The ESA is never part of this (rule 5).
 */
export function availableToSpend(cash: number, credit: Credit): number {
  return Math.max(0, cash) + creditLeft(credit);
}

/**
 * True once cash is spent and the member has crossed into credit (rule 6). Marks
 * the crossing visibly — the cash figure takes the boost color and the credit card
 * takes an accent border — but never alarmingly.
 */
export function isCreditEngaged(cash: number, credit: Credit): boolean {
  return cash <= 0 && creditUsed(credit) > 0;
}

/** Total savings balance. Locked — never summed into "available to spend" (rule 5). */
export function savingsTotal(s: Savings): number {
  return s.cash + s.vested + s.vesting;
}

/** A section's full capacity, including tiers the member hasn't opted into. */
export function sectionTotal(rows: LimitBackingRow[]): number {
  return rows.reduce((sum, r) => sum + r.contribution, 0);
}

/**
 * The limit actually being extended. Excludes opt-in tiers that haven't been
 * added — Boost is listed under its section's capacity but doesn't count toward
 * the limit until it's taken up.
 */
export function backingTotal(b: LimitBacking): number {
  return [...b.assetBacked, ...b.unsecured]
    .filter((r) => !r.dimmed)
    .reduce((sum, r) => sum + r.contribution, 0);
}

/** Bar fill and legend-dot color per tier. */
export const TIER_FILL: Record<TierKey, string> = {
  savings: 'bg-tier-savings',
  asset: 'bg-tier-asset',
  income: 'bg-tier-income',
  boost: 'bg-tier-boost',
};

export const TIER_TEXT: Record<TierKey, string> = {
  savings: 'text-tier-savings-fg',
  asset: 'text-tier-asset-fg',
  income: 'text-tier-income-fg',
  boost: 'text-tier-boost-fg',
};
