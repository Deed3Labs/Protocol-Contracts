/*
 * The ELPA (Addendum 3; owner decisions in docs/audit/specs/phase-2f-decisions.md).
 *
 * What it is NOT: credit, a term plan or a mortgage. Nothing here is a balance owed, nothing here
 * feeds a limit, and nothing here is read by the credit or term-plan code (creditMapping, the term
 * shelf, the limit breakdown). A test pins that.
 *
 * Two monthly parts (MB-13 §6.1), and they are kept apart on every surface:
 *
 *  1. The Equity Contribution. The member chooses the amount each month; the minimum is 0.30% of the
 *     Structure Price. It is equity and never a debt (MB-13 §6.3), so it is shown as progress toward
 *     Redemption: the Equity Balance against the Structure Price, and a projected Redemption date.
 *     It has no due date, no past-due or late state, no reminders and no dunning. The one contact the
 *     owner allows is a single informational check-in after six consecutive months below the
 *     minimum, outside a pause.
 *
 *  2. The Community Fee (MB-14 Article 5): Ground Rent, Property Charges, Community Charges and
 *     Service Charges. This one IS owed, due on the 1st, and is shown as an ordinary housing bill.
 *     No late fee; 5% simple interest only after 60 days; Service Charges are never a default.
 *     Before Redemption it is paid with the monthly payment under MB-13, but always shown as its own
 *     line. It never appears in the credit view and never affects a limit.
 *
 * Off chain by design. No contract records any of this, contributions are fiat (the app, Autopay,
 * ACH, check or money order) and there is no USDC path, so this module makes no contract call. The
 * one on-chain event is Redemption: the Clear Deed moves to the member's Smart Account, and the
 * Redeemed state shows that deed.
 */

/** The minimum Equity Contribution each month, as a share of the Structure Price (MB-13 §6.1). */
export const MIN_CONTRIBUTION_RATE = 0.003;

/** Consecutive months below the minimum, outside a pause, before the one informational check-in. */
export const CHECK_IN_AFTER_MONTHS = 6;

export type CommunityFeeLineKind = 'ground-rent' | 'property' | 'community' | 'service';

/** MB-14 Article 5's four parts, in the order the statement lists them. */
export const COMMUNITY_FEE_LINES: { kind: CommunityFeeLineKind; label: string }[] = [
  { kind: 'ground-rent', label: 'Ground Rent' },
  { kind: 'property', label: 'Property Charges' },
  { kind: 'community', label: 'Community Charges' },
  { kind: 'service', label: 'Service Charges' },
];

/** The Community Fee's terms, in the member's words. MB-14 Article 5. */
export const COMMUNITY_FEE_TERMS =
  'Due on the 1st. No late fee. If it goes unpaid for more than 60 days, 5% simple interest starts. Service Charges are never treated as a default.';

/** Before Redemption the fee rides with the monthly payment (MB-13), shown as its own line. */
export const COMMUNITY_FEE_WITH_PAYMENT = 'Paid with your monthly payment, shown here on its own.';

export interface CommunityFeeStatement {
  /** The month billed, e.g. "December 2026". */
  period: string;
  /** Always the 1st of the month, ISO date, e.g. "2026-12-01". */
  dueOn: string;
  lines: { kind: CommunityFeeLineKind; amount: number }[];
  paid: boolean;
  /** Interest the books have accrued after the 60-day mark. Zero or absent before it. */
  interest?: number;
}

export interface ElpaActive {
  status: 'active';
  /** The home, e.g. "1042 Julia St". */
  home: string;
  structurePrice: number;
  equityBalance: number;
  /** What the member chose for this month. Null before they have chosen. */
  contributionThisMonth: number | null;
  /** When Redemption lands at the member's recent pace, ISO month ("2041-03"). Null with no pace yet. */
  projectedRedemption: string | null;
  /** Consecutive months below the minimum, counted by the books. */
  monthsBelowMinimum: number;
  /** A pause under MB-13: months inside it never count toward the check-in. */
  paused: boolean;
  communityFee: CommunityFeeStatement | null;
}

export interface ElpaRedeemed {
  status: 'redeemed';
  home: string;
  /** ISO date of the Redemption transfer. */
  redeemedOn: string;
  /** The Clear Deed, as transferred on chain to the member's Smart Account. */
  deed: { tokenId: string; smartAccount: string; transaction?: string };
  /** The Community Fee continues after Redemption under MB-14. */
  communityFee: CommunityFeeStatement | null;
}

export type ElpaState = { status: 'none' } | ElpaActive | ElpaRedeemed;

/** Where the ELPA is read from: Clear's books, through an API. Never a contract. */
export interface ElpaSource {
  read(): Promise<ElpaState>;
}

/**
 * STUB. No books API serves the ELPA yet, so the live app reads "no ELPA" from here, which is the
 * true answer for every member today (the first ELPA is gate G4). When the books endpoint exists,
 * this is the one thing to replace: a typed read of the Equity Balance, Structure Price, projection
 * and Community Fee statement. It must stay an off-chain read.
 */
export const elpaBooksStub: ElpaSource = {
  read: async () => ({ status: 'none' }),
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** This month's minimum Equity Contribution: 0.30% of the Structure Price. */
export function minimumContribution(structurePrice: number): number {
  return cents(structurePrice * MIN_CONTRIBUTION_RATE);
}

/** How far toward Redemption, 0–1: the Equity Balance against the Structure Price. */
export function redemptionProgress(state: Pick<ElpaActive, 'equityBalance' | 'structurePrice'>): number {
  if (state.structurePrice <= 0) return 0;
  return Math.max(0, Math.min(1, state.equityBalance / state.structurePrice));
}

/**
 * Whether the one informational check-in applies: six consecutive months below the minimum, outside
 * a pause. It is information, never a reminder, a due date or a consequence.
 */
export function showsCheckIn(state: Pick<ElpaActive, 'monthsBelowMinimum' | 'paused'>): boolean {
  return !state.paused && state.monthsBelowMinimum >= CHECK_IN_AFTER_MONTHS;
}

export const CHECK_IN_NOTE =
  'Your contributions have been under the monthly minimum for six months. That is your choice to make, and nothing changes because of it. If you would like to talk it through or pause, we are here.';

/** The Community Fee's total for the month, interest included when the books have accrued any. */
export function communityFeeTotal(statement: CommunityFeeStatement): number {
  return cents(statement.lines.reduce((sum, l) => sum + l.amount, 0) + (statement.interest ?? 0));
}

/** "2041-03" → "March 2041". Anything else passes through. */
export function monthName(isoMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(isoMonth);
  if (!m) return isoMonth;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** "2026-12-01" → "Dec 1". Anything else passes through. */
export function shortDay(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "0x1234…abcd". */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
