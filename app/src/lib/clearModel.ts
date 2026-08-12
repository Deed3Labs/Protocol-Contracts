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

/** Where the money moved from — spec §8 requires this tag on every row. */
export type ActivitySource = 'credit' | 'cash' | 'savings' | 'cash account' | 'pending';

/** What the row is, which is what the Activity filter chips select on. */
export type ActivityKind = 'spending' | 'deposit' | 'savings' | 'sent';

export interface ActivityRow {
  id: string;
  name: string;
  date: string;
  source: ActivitySource;
  kind: ActivityKind;
  /** Negative debits, positive credits. */
  amount: number;
}

export interface PendingClaim {
  amount: number;
  /** Who the money is waiting on. */
  recipient: string;
  sentOn: string;
  expiresInDays: number;
}

export interface ActivityData {
  rows: ActivityRow[];
  /** Net movement across the current cycle, shown beside the filters. */
  cycleNet: number;
  /** Set when money has been sent to someone who isn't a member yet. */
  pendingClaim?: PendingClaim;
}

export const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'spending', label: 'Spending' },
  { id: 'deposit', label: 'Deposits' },
  { id: 'savings', label: 'Savings' },
  { id: 'sent', label: 'Sent' },
] as const;

export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]['id'];

export function filterActivity(rows: ActivityRow[], filter: ActivityFilter): ActivityRow[] {
  return filter === 'all' ? rows : rows.filter((r) => r.kind === filter);
}

/**
 * Group rows under date headers, preserving the order they arrive in — the list
 * is already newest-first and the labels are display strings ("Today · Oct 26"),
 * so this must not re-sort or re-parse them.
 */
export function groupByDate(rows: ActivityRow[]): { date: string; rows: ActivityRow[] }[] {
  const groups: { date: string; rows: ActivityRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === row.date) last.rows.push(row);
    else groups.push({ date: row.date, rows: [row] });
  }
  return groups;
}

/** Source tags read lowercase inline ("Oct 26 · credit") and capitalised in a column. */
export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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

export interface Milestone {
  id: string;
  title: string;
  /** Equity credits needed to reach it. */
  credits: number;
  /** Trailing note, e.g. "move in". */
  note?: string;
}

export interface AssuranceItem {
  id: string;
  name: string;
  /** Credits needed before this protection turns on. */
  unlocksAt: number;
  /** Name still to be confirmed — rendered as-is, do not invent a replacement. */
  placeholder?: boolean;
}

export interface VestingRow {
  id: string;
  /** Display date, e.g. "Nov 3". */
  date: string;
  credits: number;
}

export interface SavingsData {
  savings: Savings;
  milestones: Milestone[];
  assurance: AssuranceItem[];
  vesting: VestingRow[];
}

export type MilestoneState = 'done' | 'current' | 'future';

/**
 * Milestone progress is derived from credits, never stored: everything at or
 * below the current balance is done, the next one up is current, the rest are
 * ahead. That keeps the path honest when credits move.
 */
export function milestoneStates(milestones: Milestone[], credits: number): MilestoneState[] {
  let currentTaken = false;
  return milestones.map((m) => {
    if (credits >= m.credits) return 'done';
    if (!currentTaken) {
      currentTaken = true;
      return 'current';
    }
    return 'future';
  });
}

export function isAssuranceActive(item: AssuranceItem, credits: number): boolean {
  return credits >= item.unlocksAt;
}

/** Credits still needed to unlock a protection. */
export function creditsToGo(unlocksAt: number, credits: number): number {
  return Math.max(0, unlocksAt - credits);
}

export interface YieldPool {
  /** Variable, e.g. 6.8 for 6.8% APY. */
  apy: number;
  /** Lent out to members, and the pool's total size. */
  lent: number;
  capacity: number;
  /** What this member has in, and what it has made. */
  position: number;
  earned: number;
}

export interface BondTerm {
  months: number;
  /** What you pay today. */
  price: number;
  /** What it pays out at maturity. */
  face: number;
  /** Effective annual rate, e.g. 6.5. */
  rate: number;
}

export interface HeldBond {
  id: string;
  face: number;
  months: number;
  paid: number;
  /** Display date, e.g. "Mar 14, 2028". */
  maturesOn: string;
  monthsLeft: number;
}

export interface EarnData {
  pool: YieldPool;
  terms: BondTerm[];
  bonds: HeldBond[];
  earnedToDate: number;
}

/** A bond's contribution is what was paid for it, not its face value. */
export function bondsTotal(bonds: HeldBond[]): number {
  return bonds.reduce((sum, b) => sum + b.paid, 0);
}

/** Everything currently earning: the pool position plus what's tied up in bonds. */
export function earningTotal(data: EarnData): number {
  return data.pool.position + bondsTotal(data.bonds);
}

/** Share of the pool lent out, 0–1. */
export function poolUtilization(pool: YieldPool): number {
  return pool.capacity > 0 ? Math.min(1, pool.lent / pool.capacity) : 0;
}

export interface Contact {
  id: string;
  name: string;
  /** Shown in the avatar circle. */
  initials: string;
  role: 'member' | 'partner';
}

export const CONTACT_ROLE_LABEL: Record<Contact['role'], string> = {
  member: 'Member',
  partner: 'Clear Partner',
};

export interface SendData {
  /** The member's own handle, e.g. "@kaim". */
  handle: string;
  /** What the QR encodes — the link that opens a payment to this member. */
  codeUrl: string;
  recent: Contact[];
}

/** Match a contact on name or handle, for the Send search field. */
export function searchContacts(contacts: Contact[], query: string): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return contacts;
  return contacts.filter((c) => c.name.toLowerCase().includes(q));
}

export interface CardData {
  /** Before activation there's no PAN to show and nothing to freeze. */
  activated: boolean;
  last4: string;
  cardholder: string;
  /** MM/YY. */
  expiry: string;
  /** Network wordmark, e.g. "VISA". */
  network: string;
  frozen: boolean;
  /** Statement period the transactions below cover, e.g. "October". */
  period: string;
  /** Card transactions only — Activity shows everything (spec §9). */
  transactions: ActivityRow[];
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
