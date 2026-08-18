/**
 * The member app's money model — design spec §3, "Core display rules".
 *
 * These are product decisions, not styling, so they live in one place rather than
 * being re-derived per page. Components should read these helpers instead of doing
 * their own arithmetic on balances.
 */

import { count } from './money';

export type TierKey = 'savings' | 'asset' | 'income' | 'boost';

export interface CreditTier {
  key: TierKey;
  /** Row label, e.g. "Savings (CLRUSD)". */
  label: string;
  /** Short label for narrow layouts, e.g. "Savings". */
  shortLabel?: string;
  /** Cost of carrying a balance on this tier, e.g. "free", "1.5% / cycle". */
  rate: string;
  /** The same rate as a fraction, for working out what carrying a balance costs. */
  ratePerCycle?: number;
  used: number;
  /** What this tier can back. The credit limit is the sum of these across added tiers. */
  limit: number;
  /** Boost is opt-in; a tier that hasn't been added lends nothing and isn't in the limit. */
  added: boolean;
}

export interface Credit {
  tiers: CreditTier[];
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
  /** When the limit contracts if the cycle doesn't clear, e.g. "Nov 12". */
  rebalanceBy: string;
}

/**
 * Tiers whose draw is already covered by something the co-op holds.
 *
 * Savings-backed draws against the member's own CLRUSD and asset-backed against their bonds and
 * pool position — in a default those settle from the collateral itself. Income-backed and Boost are
 * unsecured: nothing stands behind them but the member's next paycheck.
 */
export const SECURED_TIERS: TierKey[] = ['savings', 'asset'];

/** What's drawn against collateral. Doesn't need clearing; it's already covered. */
export function securedUsed(credit: Credit): number {
  return credit.tiers
    .filter((t) => SECURED_TIERS.includes(t.key))
    .reduce((sum, t) => sum + t.used, 0);
}

/**
 * What actually has to be repaid this cycle — the unsecured draw, and only that.
 *
 * The whole balance is not the target. Asking a member to clear credit that their own savings
 * already stand behind would be asking them to pay off a loan secured by their own money, and the
 * cycle would never look clear no matter how much they earned.
 */
export function unsecuredUsed(credit: Credit): number {
  return credit.tiers
    .filter((t) => !SECURED_TIERS.includes(t.key))
    .reduce((sum, t) => sum + t.used, 0);
}

/**
 * What the member still has to add, after the deposit they're expecting.
 *
 * Zero means the cycle clears on its own and the card can say so. Anything above zero is a number
 * they need to see, because nothing else in the app will tell them before the cycle closes.
 */
export function cycleShortfall(credit: Credit, expectedDeposit = 0): number {
  return Math.max(0, unsecuredUsed(credit) - Math.max(0, expectedDeposit));
}

/**
 * Which of the cycle's four states applies — spec §4b.
 *
 * `secured` is deliberately not the same as `clear`. Nothing is owed either way, but a member
 * spending against their own savings has paused their housing progress and is accruing carry on the
 * asset-backed part — so it reads neutral, not green, and offers to top the savings back up rather
 * than to pay anything down. They didn't borrow.
 *
 * Only `short` asks for anything, and it's the only state that earns the accent border.
 */
export type CycleStatus = 'short' | 'covered' | 'secured' | 'clear';

export function cycleStatus(credit: Credit | undefined, expectedDeposit = 0): CycleStatus {
  if (!credit || creditUsed(credit) === 0) return 'clear';
  if (unsecuredUsed(credit) === 0) return 'secured';
  return cycleShortfall(credit, expectedDeposit) > 0 ? 'short' : 'covered';
}

export interface RepayLine {
  tier: CreditTier;
  /** What this repayment puts against the tier. Zero means the money never reaches it. */
  applied: number;
  /** What was drawn on the tier before the repayment. */
  drawn: number;
}

/**
 * How a repayment unwinds across the tiers — design spec §4, "Repay / Move to cash".
 *
 * Most expensive first, which is the draw order reversed: tiers fill cheapest-first (rule 7), so
 * they must empty from the other end or a member would be left paying 3% while their free tier sat
 * clear. That's also why the footer says so out loud — it's the one thing about this surface a
 * member can't work out by looking.
 *
 * Unsecured tiers are always listed, even when the payment doesn't reach them: the cycle is about
 * unsecured credit, and a tier left `untouched` is exactly what the member needs to see. Secured
 * tiers only appear once money actually reaches them, because listing collateralised draw the
 * payment will never touch would pad the surface with rows that never change.
 */
export function repayAllocation(credit: Credit, amount: number): RepayLine[] {
  const drawn = orderedTiers(credit.tiers)
    .filter((t) => t.used > 0)
    .reverse();

  let left = Math.max(0, amount);
  const lines: RepayLine[] = [];

  for (const tier of drawn) {
    const applied = Math.min(left, tier.used);
    left -= applied;
    if (applied > 0 || !SECURED_TIERS.includes(tier.key)) {
      lines.push({ tier, applied, drawn: tier.used });
    }
  }

  return lines;
}

/** What a repayment of `amount` puts against the unsecured draw — the part that clears the cycle. */
export function repaidUnsecured(credit: Credit, amount: number): number {
  return repayAllocation(credit, amount)
    .filter((l) => !SECURED_TIERS.includes(l.tier.key))
    .reduce((sum, l) => sum + l.applied, 0);
}

/**
 * A savings sweep, as the app needs to see it — mirrors the server's sweep record.
 *
 * `ready_to_allocate` is the resting state, not a failure: the USDC has arrived on the member's own
 * smart wallet and where it goes next is theirs to choose.
 */
export interface SweepView {
  id: string;
  amountCents: number;
  state:
    | 'initiated'
    | 'fiat_debited'
    | 'ready_to_allocate'
    | 'clrusd_minted'
    | 'complete'
    | 'failed';
  createdAt: string;
}

/** Sweeps whose money has left the member's cash but has not arrived on-chain yet. */
export function sweepsInFlight(sweeps: SweepView[]): SweepView[] {
  return sweeps.filter((s) => s.state === 'initiated' || s.state === 'fiat_debited');
}

/** Sweeps whose USDC has landed and is waiting on the member to place it. */
export function sweepsAwaitingMember(sweeps: SweepView[]): SweepView[] {
  return sweeps.filter((s) => s.state === 'ready_to_allocate');
}

/**
 * What the member is holding on-chain from completed sweeps, in dollars.
 *
 * A floor, not the whole picture: it counts money this app put there and knows the state of. USDC
 * the member acquired any other way is only visible from a chain read, so a caller with a real
 * balance should prefer it and use this when there is nothing better.
 */
export function unallocatedFromSweeps(sweeps: SweepView[]): number {
  return sweepsAwaitingMember(sweeps).reduce((sum, s) => sum + s.amountCents, 0) / 100;
}

/**
 * In-flight sweeps as Activity rows.
 *
 * Shown as pending deposits because that is what they are from the member's side: money that left
 * their cash account and has not turned up in savings yet. ACH takes days, and a transfer that
 * vanishes from one place without appearing anywhere else reads as lost money.
 */
export function sweepActivityRows(sweeps: SweepView[]): ActivityRow[] {
  return sweepsInFlight(sweeps).map((sweep) => ({
    id: `sweep-${sweep.id}`,
    name: 'To savings',
    date: sweep.createdAt.slice(0, 10),
    source: 'pending' as const,
    kind: 'savings' as const,
    // Negative: it has left the cash account. It is not income arriving.
    amount: -(sweep.amountCents / 100),
    status: 'Pending',
  }));
}

/**
 * Everything in the cash account, spendable or not.
 *
 * Derived rather than stored, so the total can never drift from its parts — the bug where a
 * displayed balance and the numbers underneath it quietly disagree.
 */
export function cashTotal(account: Pick<CashAccount, 'spendable' | 'readyToAllocate'>): number {
  return Math.max(0, account.spendable) + Math.max(0, account.readyToAllocate);
}

/**
 * True when part of the balance cannot be spent on the card.
 *
 * Drives the marking in the UI. Showing a balance without saying which part is spendable is how a
 * member gets declined at a checkout while looking at a number that says they had the money.
 */
export function hasUnspendableCash(account: Pick<CashAccount, 'readyToAllocate'>): boolean {
  return account.readyToAllocate > 0;
}

export interface Savings {
  cash: number;
  vested: number;
  vesting: number;
  credits: number;
  creditsGoal: number;
  /** When the Clear Deed lands at the current rate, e.g. "Feb 2028". */
  onTrackFor?: string;
}

export interface CashAccount {
  /**
   * Card-spendable fiat. The only part of the cash account that can settle an authorization, and
   * the only figure that may ever feed `availableToSpend`.
   */
  spendable: number;
  /**
   * Money moved on-chain and not yet placed — USDC on the member's own smart wallet.
   *
   * Theirs, and in the cash account, but it can go to Savings or Earn and never to the card. This
   * should normally read zero: it is the exception, not where money lives. A balance sitting here
   * is money the member has not finished moving, and the card says so rather than absorbing it.
   */
  readyToAllocate: number;
  nextDepositOn: string;
  nextDepositEstimate: number;
  directDepositActive: boolean;
  /** Virtual-account details, shown behind "Account details" for direct deposit. */
  accountNumber: string;
  routingNumber: string;
  bankName: string;
  /** Who the direct deposit comes from, named in the account-details surface. */
  employer: string;
}

export interface SetupTask {
  id: string;
  label: string;
  /** Button label when this task is the one being nudged. */
  cta?: string;
  done: boolean;
}

/** Where the money moved from — spec §8 requires this tag on every row. */
export type ActivitySource =
  | 'credit'
  | 'cash'
  | 'savings'
  | 'cash account'
  | 'pending'
  /** Money in from another member. */
  | 'received';

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

  // Detail-view extras, shown when a row is opened.
  location?: string;
  /** e.g. "Oct 26, 2026 · 8:14 AM". */
  datetime?: string;
  paidFromTier?: TierKey;
  paidFromLabel?: string;
  /** Rate that applied to this particular draw, e.g. "0.65% per cycle". */
  rate?: string;
  cardLast4?: string;
  status?: string;
}

/** Where a flow draws the money from, and what's in it. */
export interface PayFrom {
  label: string;
  balance: number;
}

/**
 * The tier a draw lands on: the cheapest added tier with headroom left
 * (rule 7). Returns undefined when every tier is used up.
 */
export function nextDrawTier(credit: Credit): CreditTier | undefined {
  return orderedTiers(credit.tiers).find((t) => t.added && t.used < t.limit);
}

export interface PendingClaim {
  amount: number;
  /** Who the money is waiting on. */
  recipient: string;
  sentOn: string;
  expiresInDays: number;
}

/** The cycle's spending, split by where it was drawn from. */
export interface CycleSpend {
  spent: number;
  daysLeft: number;
  fromCash: number;
  fromCredit: number;
  carryCost: number;
}

export interface SpendCategory {
  label: string;
  amount: number;
}

export interface ActivityData {
  rows: ActivityRow[];
  /**
   * Desktop side rail. Absent on day one, when there's no cycle to summarise —
   * the list stands alone rather than showing three cards of zeroes.
   */
  cycleSpend?: CycleSpend;
  categories?: SpendCategory[];
  /** What stayed with members and Clear Partners this cycle. */
  insideCoop?: number;
  /** Set when money has been sent to someone who isn't a member yet. */
  pendingClaim?: PendingClaim;
}

/**
 * `mobile` marks the ones that earn a chip at 375px. The rest stay desktop-only
 * rather than being dropped — the filter still exists, it just isn't worth the
 * width on a phone.
 */
export const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All', mobile: true },
  { id: 'spending', label: 'Spending', mobile: true },
  { id: 'deposit', label: 'Deposits', mobile: true },
  { id: 'savings', label: 'Savings', mobile: true },
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

/**
 * Mobile group headers use only the relative part: the reference shows "Today"
 * where desktop shows "Today · Oct 26". Labels without a separator are unchanged.
 */
export function shortDate(label: string): string {
  return label.split(' · ')[0];
}

/** Source tags read lowercase inline ("Oct 26 · credit") and capitalised in a column. */
export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * How a row is tagged in the source column. A credit draw names the tier that
 * funded it — "Asset-backed", not the generic "Credit" — because which tier paid
 * is what decides the rate, and it's the only place the member sees it.
 */
export function sourceTag(row: ActivityRow): { label: string; dot?: string } {
  if (row.paidFromTier) {
    return { label: TIER_SHORT_LABEL[row.paidFromTier], dot: TIER_FILL[row.paidFromTier] };
  }
  if (row.source === 'savings') return { label: 'Savings', dot: 'bg-vest-vested' };
  if (row.source === 'cash') return { label: 'Cash', dot: 'bg-vest-cash' };
  return { label: capitalise(row.source) };
}

export interface LimitBackingRow {
  label: string;
  /** What this position contributes to the limit. */
  contribution: number;
  /** "$6,895 value today · 95% · 0.65%" */
  detail: string;
  tier: TierKey;
  /**
   * Opt-in and not taken up yet. Excluded from both the section subtotal and the
   * total — it isn't backing anything until it's added — and offered with an
   * Add action rather than being dimmed out.
   */
  notAdded?: boolean;
  /** What adding it would contribute, for the Add button's label. */
  addAmount?: number;
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
  /** What it actually covers, shown on the detail page. */
  description: string;
  /** Credits needed before this protection turns on. */
  unlocksAt: number;
  /** Name still to be confirmed — rendered as-is, do not invent a replacement. */
  placeholder?: boolean;
}

/**
 * Where a protection stands, in the words the detail page uses. Active from the
 * start says so rather than claiming a credit threshold it never had.
 */
export function assuranceStatus(item: AssuranceItem, credits: number): string {
  if (!isAssuranceActive(item, credits)) return `${count(item.unlocksAt - credits)} credits to go`;
  return item.unlocksAt > 0 ? `Active since ${count(item.unlocksAt)} credits` : 'Active';
}

/** The shared fund behind the protections — spec §5. */
export interface AssuranceReserve {
  balance: number;
  membersCovered: number;
  claimsPaidThisYear: number;
  /** How often the co-op publishes its reserve report. */
  reportCadence: string;
}

/**
 * One thing that happened, or is about to. Alerts are notifications with a
 * history, not a dropdown — the credit crossing and the rebalance date are things
 * a member goes looking for again.
 */
export interface Alert {
  id: string;
  title: string;
  detail: string;
  /** Display grouping, e.g. "Today", "This week". */
  group: string;
  /** Matches the tier or state the alert is about. */
  tone: 'boost' | 'asset' | 'muted';
  /** When it landed, already formatted — "8:14 AM", "Nov 6". */
  time: string;
  read?: boolean;
  /** Alerts you can act on carry the action, rather than making you go find it. */
  action?: { label: string; to: string };
}

/** A message conversation — spec §1. */
export interface Thread {
  id: string;
  name: string;
  initials: string;
  /** Last message, truncated in the list. */
  preview: string;
  time: string;
  unread?: boolean;
  /** e.g. "Usually replies within 4 hours" — shown in the thread header. */
  subtitle?: string;
}

export interface ChatMessage {
  id: string;
  body: string;
  /** Sent by this member rather than received. */
  mine?: boolean;
  /**
   * A transaction the message refers to, rendered as a small card under it —
   * support answering "which tier paid for this" is the whole reason messages
   * exist inside the app rather than over email.
   */
  attachment?: { label: string; tier: TierKey; note: string };
}

export interface InboxData {
  alerts: Alert[];
  threads: Thread[];
  /** Keyed by thread id. */
  messages: Record<string, ChatMessage[]>;
}

export function unreadAlerts(alerts: Alert[]): number {
  return alerts.filter((a) => !a.read).length;
}

export function unreadThreads(threads: Thread[]): number {
  return threads.filter((t) => t.unread).length;
}

/**
 * The reference paints the neutral dot with a stronger border colour than this
 * project has a token for; muted-foreground is the nearest one and reads at the
 * same weight against the card.
 */
export const ALERT_DOT: Record<Alert['tone'], string> = {
  boost: 'bg-tier-boost',
  asset: 'bg-tier-asset',
  muted: 'bg-muted-foreground',
};

/** What a member's patronage share is calculated from — spec §10. */
export interface PatronageBasisRow {
  label: string;
  amount: number;
}

export function patronageBasis(rows: PatronageBasisRow[]): number {
  return rows.reduce((sum, r) => sum + r.amount, 0);
}

export interface VestingRow {
  id: string;
  /** Display date, e.g. "Nov 3". */
  date: string;
  credits: number;
}

/** When the Clear Deed lands at the current rate, and what would move it. */
export interface SavingsProjection {
  perPayday: number;
  extraMonthly: number;
  /** The date the extra contribution would bring it to. */
  withExtra: string;
}

export interface SavingsData {
  savings: Savings;
  projection: SavingsProjection;
  /** Where a deposit into savings draws from. */
  payFrom: PayFrom;
  /** The limit today, so a deposit can show what it becomes. */
  creditLimitToday: number;
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
  /**
   * What it's worth today — the accrued value between what was paid and the face
   * value. This, not the face, is what the credit line lends against.
   */
  worthToday: number;
}

export interface EarnData {
  pool: YieldPool;
  terms: BondTerm[];
  bonds: HeldBond[];
  earnedToDate: number;
  /** Where bond purchases and pool deposits draw from. */
  payFrom: PayFrom;
  /** Loan-to-value the tiers lend at, for showing what a purchase adds to the limit. */
  bondLtv: number;
  poolLtv: number;
  /** When the member is on track to reserve a home, e.g. "Mar 2029". */
  reserveDate: string;
}

/** What buying a bond at this price adds to the credit limit, at the bond LTV. */
export function bondAddsToLimit(price: number, ltv: number): number {
  return Math.round(price * ltv);
}

/** A bond's contribution is what was paid for it, not its face value. */
export function bondsTotal(bonds: HeldBond[]): number {
  return bonds.reduce((sum, b) => sum + b.paid, 0);
}

/** Everything currently earning: the pool position plus what's tied up in bonds. */
export function earningTotal(data: EarnData): number {
  return data.pool.position + bondsTotal(data.bonds);
}

/** Sum of what the held bonds are worth today. */
export function bondsWorth(bonds: HeldBond[]): number {
  return bonds.reduce((sum, b) => sum + b.worthToday, 0);
}

/** "Mar 14, 2028" → "Mar 2028": enough to plan around, short enough for a row. */
export function monthYear(date: string): string {
  const month = date.split(' ')[0];
  const year = date.split(', ')[1];
  return year ? `${month} ${year}` : date;
}

/** How far through its term a bond is, 0–1. */
export function bondElapsed(bond: HeldBond): number {
  return bond.months > 0 ? Math.max(0, Math.min(1, (bond.months - bond.monthsLeft) / bond.months)) : 0;
}

/**
 * What each product backs on the credit line, and the total.
 *
 * This is the whole reason the two products aren't just savings accounts: money
 * locked in them still raises the limit, at the loan-to-value the tier lends at.
 * The asset-backed tier's limit on Home is this number — one derivation, so Earn
 * and Home can't quote different figures.
 */
export function poolBacking(data: EarnData): number {
  return Math.round(data.pool.position * data.poolLtv);
}

export function bondsBacking(data: EarnData): number {
  return Math.round(bondsWorth(data.bonds) * data.bondLtv);
}

export function assetBackedLimit(data: EarnData): number {
  return poolBacking(data) + bondsBacking(data);
}

/** Share of the pool lent out, 0–1. */
export function poolUtilization(pool: YieldPool): number {
  return pool.capacity > 0 ? Math.min(1, pool.lent / pool.capacity) : 0;
}

export interface MemberProfile {
  name: string;
  initials: string;
  /** Uploaded photo, if there is one. Initials are the fallback, not a placeholder. */
  avatarUrl?: string | null;
  handle: string;
  memberSince: string;
  legalName: string;
  phone: string;
  email: string;
  address: string;
  region: string;
  /** One member, one vote — the co-op rule, not a computed figure. */
  votes: number;
  walletAddress: string;
  /** Masked — only the year is shown, since it's locked after verification. */
  dateOfBirth: string;
}

export interface TrustedDevice {
  id: string;
  name: string;
  /** "Redlands, CA · active now" */
  detail: string;
  /** The one you're on — can't be removed from itself. */
  current?: boolean;
}

export interface NotificationPref {
  id: string;
  label: string;
  /** What actually triggers it, so the label doesn't have to guess. */
  detail: string;
}

export interface NotificationGroup {
  title: string;
  prefs: NotificationPref[];
}

/** One row of the standard-vs-accelerated comparison. */
export interface AccelerationBenefit {
  label: string;
  standard: string;
  accelerated: string;
  /** Accelerated-only, shown as a check rather than a value. */
  acceleratedOnly?: boolean;
}

export interface AccelerationPlan {
  id: string;
  label: string;
}

/** What leaving would actually cost, spelled out before anyone commits. */
export interface AccountClosure {
  savingsReturned: number;
  creditToSettle: number;
  bondsNote: string;
  creditsForfeited: number;
}

/** Positive means the member is owed; negative means they owe. */
export function closureBalance(closure: AccountClosure): number {
  return closure.savingsReturned - closure.creditToSettle;
}

/** A document the member has agreed to, or can read. */
export interface LegalDoc {
  id: string;
  label: string;
  detail?: string;
  /** Documents that get amended carry a version; static ones don't. */
  version?: string;
}

export interface HelpTopic {
  id: string;
  question: string;
}

export interface BylawArticle {
  id: string;
  title: string;
  clauses: { number: string; text: string }[];
}

export interface Bylaws {
  version: string;
  /** e.g. "Jun 2026". */
  updated: string;
  articles: BylawArticle[];
}

/**
 * Patronage — the co-op's surplus returned in proportion to how much a member
 * used it, not how much they saved. Those are different mechanisms and the copy
 * has to keep saying so.
 */
export interface Patronage {
  fiscalYear: string;
  status: string;
  /** The activity the share is calculated from; the basis is their sum. */
  basisRows: PatronageBasisRow[];
  /** Declared so far this year; absent while the year is still running. */
  declared?: number;
  history: { id: string; year: string; amount: number }[];
}

export interface Ballot {
  id: string;
  question: string;
  closesOn: string;
  closesInDays: number;
  /** Turnout so far — the number that decides whether a vote is legitimate. */
  voted: number;
  members: number;
  options: { id: string; label: string }[];
}

export interface PastVote {
  id: string;
  title: string;
  /** e.g. "Jun 2026 · Passed 84%". */
  detail: string;
  participated: boolean;
}

export interface LoginEvent {
  id: string;
  device: string;
  /** Where from and how, e.g. "Redlands, CA · Face ID". */
  detail: string;
  when: string;
}

export interface SettingsData {
  profile: MemberProfile;
  accelerationActive: boolean;
  accelerationBenefits: AccelerationBenefit[];
  accelerationPlans: AccelerationPlan[];
  accelerationCyclesToBoost: number;
  faceIdOn: boolean;
  /** Payments above this amount ask for biometrics again. */
  paymentFaceIdOver: number;
  /** Last sign-in, already formatted — "today, 8:02 AM". */
  lastLogin: string;
  /** Members who can vouch for a locked-out account. Empty reads "None set". */
  recoveryContacts: string[];
  devices: TrustedDevice[];
  notificationGroups: NotificationGroup[];
  linkedAccountCount: number;
  externalBank: string;
  employer: string;
  closure: AccountClosure;
  votesCast: number;
  legalDocs: LegalDoc[];
  helpTopics: HelpTopic[];
  bylaws: Bylaws;
  patronage: Patronage;
  /** The vote currently open, if there is one. */
  ballot?: Ballot;
  pastVotes: PastVote[];
  logins: LoginEvent[];
}

export interface Contact {
  id: string;
  name: string;
  /** e.g. "@diegor". Members get one; everyone else is reached by phone or email. */
  handle?: string;
  /** Phone or email, for someone who hasn't joined yet. */
  contactPoint?: string;
  /** Shown in the avatar circle. */
  initials: string;
  role: 'member' | 'partner';
  /**
   * Not a member yet: sending creates a claim link instead of a transfer, and
   * they get an Invite action rather than a send one.
   */
  pending?: boolean;
}

/** How a contact is identified under their name — handle if they have one. */
export function contactHandle(contact: Contact): string {
  return contact.handle ?? contact.contactPoint ?? '';
}

/** A business that accepts Clear Pay — spec §7. */
export interface Partner {
  id: string;
  name: string;
  initials: string;
  /** e.g. "Modular homes", "Trades". */
  category: string;
  city: string;
}

export const CONTACT_ROLE_LABEL: Record<Contact['role'], string> = {
  member: 'Member',
  partner: 'Clear Partner',
};

export interface PartnersData {
  partners: Partner[];
  /** Total, which can exceed what's listed. */
  count: number;
  /** Where "near you" means, e.g. "the Inland Empire". */
  region: string;
  /** e.g. "Partners shown are within 20 miles of Redlands." */
  radiusNote: string;
  /** The same fact at phone width. */
  radiusShort: string;
}

/**
 * Category chips for the partner list, derived rather than curated so a new kind
 * of business can't be filtered out by an out-of-date list. Every category shows
 * on both layouts — the strip scrolls, and a filter you can't reach is the same
 * as a filter that doesn't exist.
 */
export function partnerCategories(partners: Partner[]) {
  const seen: string[] = [];
  for (const p of partners) if (!seen.includes(p.category)) seen.push(p.category);
  return [
    { id: 'all', label: 'All', mobile: true },
    ...seen.map((c) => ({ id: c, label: c, mobile: true })),
  ];
}

export interface SendData {
  /** The member's own handle, e.g. "@kaim". */
  handle: string;
  /** Where a send draws from, and the fee/settlement copy that goes with it. */
  payFrom: PayFrom;
  /** What the QR encodes — the link that opens a payment to this member. */
  codeUrl: string;
  contacts: Contact[];
  /** The few partners shown inline; the full list is its own page. */
  partners: Partner[];
  /** How many partners there are in total, for the "See all" link. */
  partnerCount: number;
  /** Sent to members and partners this cycle — money that stayed in the co-op. */
  keptInNetwork: number;
  /** Money sent to someone who hasn't joined yet, still waiting to be claimed. */
  pendingClaim?: PendingClaim;
}

/** Match a contact on name or handle, for the Send search field. */
export function searchContacts(contacts: Contact[], query: string): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return contacts;
  return contacts.filter((c) => c.name.toLowerCase().includes(q));
}

/** A card capability the member can switch off without freezing the whole card. */
export interface CardControl {
  id: string;
  label: string;
  on: boolean;
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
  /** Full number and security code — only ever shown behind a timed reveal. */
  pan: string;
  cvc: string;
  /** Statement period the transactions below cover, e.g. "October". */
  period: string;
  /** What the card spent over that period. */
  periodTotal: number;
  /** Which card is on screen — the same account, two ways to present it. */
  variant: 'physical' | 'virtual';
  controls: CardControl[];
  perTransactionLimit: number;
  perDayLimit: number;
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
  termPlans: TermPlans;
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

/**
 * The credit limit: what the added tiers back, summed. There is only one limit —
 * it equals the total in the limit breakdown, because it IS that total.
 *
 * An opt-in tier that hasn't been taken up lends nothing until it's added, so it
 * doesn't count. Fixed within a cycle (rule 3) because the tier limits are;
 * only `used` moves in realtime.
 */
export function creditLimit(credit: Credit): number {
  return credit.tiers.filter((t) => t.added).reduce((sum, t) => sum + t.limit, 0);
}

/** Credit still available this cycle. Never negative. */
export function creditLeft(credit: Credit): number {
  return Math.max(0, creditLimit(credit) - creditUsed(credit));
}

/** The opt-in tier a member could still switch on, if there is one. */
export function addableTier(credit: Credit): CreditTier | undefined {
  return credit.tiers.find((t) => !t.added && t.limit > 0);
}

/**
 * available = cash + (limit − used) — rule 2. Cash spends first; credit engages
 * only once cash hits zero. The ESA is never part of this (rule 5).
 *
 * `cash` here is SPENDABLE cash only — never `cashTotal`. USDC sitting on the member's smart wallet
 * is theirs, but it cannot settle a card authorization, and counting it would offer spend the card
 * would then decline. Same split the server's tier snapshot makes for the same reason.
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

/** What a section actually backs. Opt-in rows not yet added contribute nothing. */
export function sectionTotal(rows: LimitBackingRow[]): number {
  return rows.filter((r) => !r.notAdded).reduce((sum, r) => sum + r.contribution, 0);
}

/**
 * The limit being extended — both sections summed, and the same figure as
 * `creditLimit()`. The breakdown explains the number on the credit card, so the
 * two must never disagree.
 */
export function backingTotal(b: LimitBacking): number {
  return sectionTotal(b.assetBacked) + sectionTotal(b.unsecured);
}

/** Bar fill and legend-dot color per tier. */
export const TIER_FILL: Record<TierKey, string> = {
  savings: 'bg-tier-savings',
  asset: 'bg-tier-asset',
  income: 'bg-tier-income',
  boost: 'bg-tier-boost',
};

/**
 * Headroom fill — the part of an added tier that hasn't been drawn on.
 *
 * A tint of the tier's own colour rather than plain track, so the credit bar
 * reads as "this much of each tier is left" instead of one anonymous remainder.
 */
export const TIER_TINT: Record<TierKey, string> = {
  savings: 'bg-tier-savings/25',
  asset: 'bg-tier-asset/25',
  income: 'bg-tier-income/25',
  boost: 'bg-tier-boost/25',
};

/** Tier names short enough for a table column. */
export const TIER_SHORT_LABEL: Record<TierKey, string> = {
  savings: 'Savings',
  asset: 'Asset-backed',
  income: 'Income-backed',
  boost: 'Boost',
};

export const TIER_TEXT: Record<TierKey, string> = {
  savings: 'text-tier-savings-fg',
  asset: 'text-tier-asset-fg',
  income: 'text-tier-income-fg',
  boost: 'text-tier-boost-fg',
};

/* ---- Term plans — design spec §4c -------------------------------------------------------------
 *
 * Everything with a set amount and a schedule: a merchant split, a cash plan, a ground lease, an
 * ELPA mortgage. What makes something a term plan is not its size but what backs it — an ACH
 * authorisation on a linked external account. That's more direct than a card, and it's why the
 * co-op can issue to a member who may never route their paycheck to Clear.
 *
 * Locked rows are part of the shelf from the first minute, on both signup paths. A member who
 * joined at a tire counter should see the home on the same shelf as the repair.
 */

export interface TermPlan {
  id: string;
  /** e.g. "Mike's Tire" or "Cash plan". */
  name: string;
  /** Merchant plans carry the month they were opened, e.g. "Jun". */
  openedOn?: string;
  /**
   * Outstanding balance. Absent on a locked row — there's nothing to state until it's taken up, and
   * a `$0.00` would read as a plan with nothing left rather than one never started.
   */
  balance?: number;
  /** How many cycles the amount is spread over. Absent for amortising plans like an ELPA. */
  splitInto?: number;
  perCycle?: number;
  cyclesLeft?: number;
  /** e.g. "2% / cycle". */
  rate?: string;
  /** Long-dated plans count payments instead of cycles left, e.g. "payment 7 of 360". */
  progressNote?: string;
  /** What it takes to unlock, e.g. "Unlocks after six clean cycles · 2.5% / cycle". */
  lockedNote?: string;
}

export interface LinkedAccount {
  id: string;
  /** e.g. "Chase ····4471". */
  name: string;
  /** e.g. "Checking · paycheck arrives here". */
  detail: string;
}

export interface TermPlans {
  plans: TermPlan[];
  /**
   * Cap on total outstanding across cycle-scale plans, stated beside the headline as "of $X".
   *
   * Absent once the shelf carries something this cap was never meant to bound — an ELPA mortgage is
   * amortising and sits outside it, and "$250,910.00 of $656.00" would be a category error rather
   * than a limit. The headline simply stops comparing.
   */
  balanceLimit?: number;
  /**
   * What can be scheduled per cycle, and where it comes from. A different quantity from
   * `balanceLimit` — this one paces the schedule, that one caps the debt — so they get separate
   * fields and separate places on the card.
   */
  perCycleLimit?: number;
  limitNote?: string;
  /** Linked accounts the ACH fallback can draw on, and which one is active. */
  accounts: LinkedAccount[];
  clearsFromId?: string;
  /** The splits offered at checkout, e.g. [1, 2, 4, 12]. */
  splitOptions: number[];
}

/** A plan is live once it has a balance; everything else on the shelf is a locked row. */
export function isPlanActive(plan: TermPlan): boolean {
  return plan.balance !== undefined;
}

export function activePlans(data: TermPlans): TermPlan[] {
  return data.plans.filter(isPlanActive);
}

/**
 * What's outstanding across every live plan.
 *
 * Summed rather than stated, so the headline can't drift from the rows beneath it — which is
 * exactly what the reference mockups did between their desktop and mobile drafts.
 */
export function termPlansTotal(data: TermPlans): number {
  return activePlans(data).reduce((sum, p) => sum + (p.balance ?? 0), 0);
}

export function clearsFromAccount(data: TermPlans): LinkedAccount | undefined {
  return data.accounts.find((a) => a.id === data.clearsFromId);
}

/** "Balance, then Chase ····4471" — the co-op's money comes first, always. */
export function clearsFromLabel(data: TermPlans): string {
  const account = clearsFromAccount(data);
  return account ? `Balance, then ${account.name}` : 'Balance only';
}

export interface SplitQuote {
  /** 1 means clearing it outright, with no carry at all. */
  splitInto: number;
  perCycle: number;
  /** Total carry over the life of the plan. Zero when paid in full. */
  carry: number;
}

/**
 * What a given split costs — design spec §4c, "Choosing the split".
 *
 * Carry accrues by time held and there's no fixed due date, so spreading further always costs more
 * and clearing early always costs less. Stating the total carry per option is what makes the choice
 * honest: the number does the work a warning would otherwise have to.
 *
 * Charged on the balance still outstanding each cycle, which for an even split is the average of
 * what's owed at the start and at the end — hence the (n + 1) / 2 term rather than n.
 */
export function splitQuote(amount: number, splitInto: number, ratePerCycle: number): SplitQuote {
  const cycles = Math.max(1, splitInto);
  const perCycle = amount / cycles;
  // Paying in full clears before any cycle elapses, so nothing accrues.
  const carry = cycles === 1 ? 0 : amount * ratePerCycle * ((cycles + 1) / 2);
  return { splitInto: cycles, perCycle, carry };
}
