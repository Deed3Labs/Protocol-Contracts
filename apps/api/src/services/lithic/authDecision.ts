/*
 * The waterfall — spec step 3. Cash first, then credit tiers cheapest-first.
 *
 * Pure on purpose: no database, no network, no clock. Everything it needs arrives as arguments, so
 * it can be reasoned about and tested exhaustively, and so the authorization handler's only job is
 * to fetch a snapshot, call this, and write the result down. The spec's rule that the tier decision
 * is "a precomputed lookup, not a calculation" is about the *availability* being precomputed; the
 * split across tiers is arithmetic on numbers already in hand.
 *
 * Draw order is the cost order, and it is not configurable — it is the product:
 *   cash (free) → savings-backed (free) → asset-backed (0.65–0.75%) → income-backed (1.5%)
 *   → boost (3%)
 * Anything else would silently charge a member more than they had to pay.
 */

export const TIER_ORDER = ['cash', 'savings', 'asset', 'income', 'boost'] as const;
export type DrawSource = (typeof TIER_ORDER)[number];

/** Everything spendable, in cents, precomputed by whatever last changed a balance. */
export interface TierAvailability {
  /** Lithic fiat balance. The only tier that settles without issuing credit. */
  cashCents: number;
  savingsCents: number;
  assetCents: number;
  incomeCents: number;
  /** Zero when Clear Boost hasn't been added — an opt-in tier backs nothing until it's taken up. */
  boostCents: number;
}

export interface Draw {
  source: DrawSource;
  amountCents: number;
}

/** Lithic's ASA verdicts. Anything but APPROVED or CHALLENGE declines the transaction. */
export type AsaResult =
  | 'APPROVED'
  | 'INSUFFICIENT_FUNDS'
  | 'CARD_PAUSED'
  | 'SUSPECTED_FRAUD'
  | 'UNAUTHORIZED_MERCHANT'
  | 'VELOCITY_EXCEEDED';

export interface AuthDecision {
  result: AsaResult;
  /** How the PURCHASE was funded, cheapest first. Empty on a decline. Never includes the fee. */
  draws: Draw[];
  /** The purchase's credit part — everything but cash. This is a credit issuance. Never the fee. */
  creditCents: number;
  /** What was spendable when the decision was made, for the audit trail. */
  availableCents: number;
  /**
   * The card credit fee added on top of the purchase (decision 55), in cents. Zero when there is
   * none: the fee is off, the purchase was paid from cash, it drew only from tiers the fee does not
   * apply to, or it was under the minimum.
   */
  feeCents: number;
  /** How the fee was funded: credit tiers only, drawn after the purchase, cheapest first. */
  feeDraws: Draw[];
}

/** The credit tiers, cheapest first: everything the waterfall can draw except the member's cash. */
export const CREDIT_TIERS = TIER_ORDER.filter((source) => source !== 'cash') as Exclude<DrawSource, 'cash'>[];

/**
 * The card credit fee's settings, as the decision needs them (decision 55).
 *
 * `cents` is the fee actually in force: the API's setting, and only when the chain's
 * `maxCardCreditFee` covers it. Zero means off. Resolved before the decision (cardCreditFee.ts), from
 * a value cached off the authorization path, so this file never knows a chain exists.
 */
export interface CreditFeeInput {
  cents: number;
  /** A purchase that draws from any of these tiers carries the fee. Cash never does. */
  tiers: DrawSource[];
  /** A purchase below this many cents carries no fee. */
  minPurchaseCents: number;
}

export function totalAvailable(availability: TierAvailability): number {
  return (
    Math.max(0, availability.cashCents) +
    Math.max(0, availability.savingsCents) +
    Math.max(0, availability.assetCents) +
    Math.max(0, availability.incomeCents) +
    Math.max(0, availability.boostCents)
  );
}

function availableIn(availability: TierAvailability, source: DrawSource): number {
  const raw = (() => {
    switch (source) {
      case 'cash':
        return availability.cashCents;
      case 'savings':
        return availability.savingsCents;
      case 'asset':
        return availability.assetCents;
      case 'income':
        return availability.incomeCents;
      case 'boost':
        return availability.boostCents;
    }
  })();
  // A NULL column arrives as NaN, and every comparison against NaN is false — a tier we cannot read
  // is a tier with no room, never one with infinite room.
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

export interface DecideInput {
  amountCents: number;
  availability: TierAvailability;
  /** A frozen card declines before any balance is consulted. */
  cardPaused?: boolean;
  /** The card credit fee, when one is in force. Absent or zero cents: no fee. */
  creditFee?: CreditFeeInput;
  /**
   * The member is a covered borrower under the Military Lending Act (MB-04 §5.10): no card credit fee
   * while they are, whatever the settings. Read from the snapshot, like everything else here.
   */
  coveredBorrower?: boolean;
}

/** A decision that holds nothing: every decline, and the approvals that draw nothing. */
function nothingDrawn(result: AsaResult, availableCents: number): AuthDecision {
  return { result, draws: [], creditCents: 0, availableCents, feeCents: 0, feeDraws: [] };
}

/**
 * Whether this purchase carries the card credit fee, and how much: the fee's own rule, apart from
 * whether the line can fund it. Null when the fee settings cannot be read, which the caller treats
 * as a decline (fail closed): a fee we cannot reason about must never be waved through as zero, nor
 * charged as whatever NaN happens to compare as.
 */
export function creditFeeFor(
  draws: Draw[],
  amountCents: number,
  fee: CreditFeeInput | undefined,
): number | null {
  if (!fee) return 0;
  // A purchase paid from cash never carries the fee, whatever the settings say.
  if (!draws.some((d) => d.source !== 'cash' && d.amountCents > 0)) return 0;
  const cents: unknown = fee.cents;
  const minimum: unknown = fee.minPurchaseCents === undefined ? 0 : fee.minPurchaseCents;
  if (typeof cents !== 'number' || !Number.isFinite(cents) || cents < 0) return null;
  if (typeof minimum !== 'number' || !Number.isFinite(minimum)) return null;
  if (cents === 0) return 0;
  const tiers = new Set((Array.isArray(fee.tiers) ? fee.tiers : []).filter((t) => t !== 'cash'));
  const drawsFeeTier = draws.some((d) => d.source !== 'cash' && d.amountCents > 0 && tiers.has(d.source));
  if (!drawsFeeTier) return 0;
  if (amountCents < Math.max(0, minimum)) return 0;
  return Math.round(cents);
}

/**
 * Decide one authorization.
 *
 * Declines the whole amount when there isn't enough rather than approving part of it: Lithic
 * supports partial approval via `approved_amount`, but a card that silently pays some of a bill is
 * a worse surprise at a till than one that says no. Making that a product option is a separate
 * decision, not a default.
 */
export function decide({ amountCents, availability, cardPaused, creditFee, coveredBorrower }: DecideInput): AuthDecision {
  const available = totalAvailable(availability);

  // Fail closed on a number we cannot reason about. Every comparison against NaN is false, so an
  // availability with a NULL column behind it would slip past the insufficient-funds check and past
  // the defensive remainder check below, and approve an unfunded charge. The one outcome this file
  // exists to prevent.
  if (!Number.isFinite(available) || !Number.isFinite(amountCents)) {
    return nothingDrawn('INSUFFICIENT_FUNDS', 0);
  }

  if (cardPaused) {
    return nothingDrawn('CARD_PAUSED', available);
  }

  // A zero or negative amount is not a spend; nothing to fund, nothing to refuse.
  if (amountCents <= 0) {
    return nothingDrawn('APPROVED', available);
  }

  if (amountCents > available) {
    return nothingDrawn('INSUFFICIENT_FUNDS', available);
  }

  const { draws, shortfallCents } = drawUpTo(availability, amountCents);

  // Defensive: `available` is the sum of the same numbers the waterfall walks, so this cannot be hit
  // without the two disagreeing. If they ever do, fail closed rather than approve unfunded spend.
  if (shortfallCents > 0) {
    return nothingDrawn('INSUFFICIENT_FUNDS', available);
  }

  const creditCents = draws
    .filter((d) => d.source !== 'cash')
    .reduce((sum, d) => sum + d.amountCents, 0);

  /*
   * The card credit fee (decision 55). The purchase above is decided exactly as it always was; the
   * fee comes after it, on top, from the credit tiers that still have room, cheapest first. Never
   * from cash: the fee is a credit draw like the purchase it rides on, owed and carried the same way
   * (and by construction the cash is gone by the time a purchase reaches credit). All or nothing,
   * like the purchase: a member whose line can take the purchase but not the fee is declined, never
   * approved with a fee nobody can fund.
   */
  const feeCents = coveredBorrower === true ? 0 : creditFeeFor(draws, amountCents, creditFee);
  if (feeCents === null) return nothingDrawn('INSUFFICIENT_FUNDS', available);
  if (feeCents === 0) {
    return { result: 'APPROVED', draws, creditCents, availableCents: available, feeCents: 0, feeDraws: [] };
  }

  const left = applyDraws(availability, draws);
  const feeDraws: Draw[] = [];
  let remaining = feeCents;
  for (const source of CREDIT_TIERS) {
    if (remaining <= 0) break;
    const room = availableIn(left, source);
    if (room <= 0) continue;
    const take = Math.min(room, remaining);
    feeDraws.push({ source, amountCents: take });
    remaining -= take;
  }
  if (remaining > 0) return nothingDrawn('INSUFFICIENT_FUNDS', available);

  return { result: 'APPROVED', draws, creditCents, availableCents: available, feeCents, feeDraws };
}

/**
 * The waterfall without the all-or-nothing rule: take as much as fits, cheapest first, and say what
 * did not fit.
 *
 * `decide` refuses a purchase it cannot fund in full, which is right at a till — a card that pays
 * some of a bill is a worse surprise than one that says no. But money that has *already moved* gets
 * no such veto. When a clearing lands above its authorization (a tip added after the swipe, a fuel
 * pump settling the real number), the charge is a fact and the only question is which tiers carry
 * it. That is what the shortfall is for: it is recorded, not discarded.
 */
export function drawUpTo(
  availability: TierAvailability,
  amountCents: number,
): { draws: Draw[]; shortfallCents: number } {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { draws: [], shortfallCents: 0 };
  }

  const draws: Draw[] = [];
  let remaining = amountCents;

  for (const source of TIER_ORDER) {
    if (remaining <= 0) break;
    const room = availableIn(availability, source);
    if (room <= 0) continue;
    const take = Math.min(room, remaining);
    draws.push({ source, amountCents: take });
    remaining -= take;
  }

  return { draws, shortfallCents: remaining };
}

/**
 * Give an amount back, and decide which tiers get it.
 *
 * Reverse cost order — the most expensive credit is retired first. A member who is handed back $20
 * of a $50 charge should stop paying 3% boost interest before they stop paying 0.65% asset interest;
 * releasing in draw order would leave the dearest borrowing outstanding and is simply worse for them.
 *
 * Never gives back more than a tier actually took, so a release cannot invent availability that was
 * never drawn down.
 */
export function releaseDraws(drawn: Draw[], amountCents: number): Draw[] {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return [];

  const back: Draw[] = [];
  let remaining = amountCents;

  for (const source of [...TIER_ORDER].reverse()) {
    if (remaining <= 0) break;
    const took = drawn
      .filter((d) => d.source === source)
      .reduce((sum, d) => sum + (Number.isFinite(d.amountCents) ? d.amountCents : 0), 0);
    if (took <= 0) continue;
    const give = Math.min(took, remaining);
    back.push({ source, amountCents: give });
    remaining -= give;
  }

  return back;
}

/**
 * Combine draws into one per tier, in cost order. Dropping a tier whose amount reaches zero, because
 * a draw of nothing is not a draw.
 */
export function mergeDraws(...groups: Draw[][]): Draw[] {
  const totals = new Map<DrawSource, number>();
  for (const group of groups) {
    for (const draw of group) {
      if (!Number.isFinite(draw.amountCents)) continue;
      totals.set(draw.source, (totals.get(draw.source) ?? 0) + draw.amountCents);
    }
  }
  return TIER_ORDER.filter((source) => (totals.get(source) ?? 0) > 0).map((source) => ({
    source,
    amountCents: totals.get(source) as number,
  }));
}

/** Apply a decision to an availability snapshot, returning the new one. */
export function applyDraws(
  availability: TierAvailability,
  draws: Draw[],
): TierAvailability {
  const next = { ...availability };
  for (const draw of draws) {
    switch (draw.source) {
      case 'cash':
        next.cashCents -= draw.amountCents;
        break;
      case 'savings':
        next.savingsCents -= draw.amountCents;
        break;
      case 'asset':
        next.assetCents -= draw.amountCents;
        break;
      case 'income':
        next.incomeCents -= draw.amountCents;
        break;
      case 'boost':
        next.boostCents -= draw.amountCents;
        break;
    }
  }
  return next;
}

/** The inverse: put draws back on the snapshot they came off. */
export function restoreDraws(availability: TierAvailability, draws: Draw[]): TierAvailability {
  return applyDraws(
    availability,
    draws.map((draw) => ({ ...draw, amountCents: -draw.amountCents })),
  );
}
