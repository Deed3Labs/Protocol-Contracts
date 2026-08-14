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
  /** What's expected to land on that date and settle the cycle. */
  clearsEstimate?: number;
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
  balance: number;
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
 * `mobile` marks the three that fit a phone without scrolling the strip. The rest
 * are desktop-only rather than dropped — the filter still exists, it just isn't
 * worth a chip at 375px.
 */
export const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All', mobile: true },
  { id: 'spending', label: 'Spending', mobile: true },
  { id: 'deposit', label: 'Deposits' },
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
  /** What the member's share is calculated from. */
  basis: number;
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
}

/**
 * Category chips for the partner list, derived rather than curated so a new kind
 * of business can't be filtered out by an out-of-date list. The first few are
 * marked for mobile, where the strip only fits about three.
 */
export function partnerCategories(partners: Partner[]) {
  const seen: string[] = [];
  for (const p of partners) if (!seen.includes(p.category)) seen.push(p.category);
  return [
    { id: 'all', label: 'All', mobile: true },
    ...seen.map((c, i) => ({ id: c, label: c, mobile: i < 2 })),
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
