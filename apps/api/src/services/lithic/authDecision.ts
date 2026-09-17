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
  /** How the amount was funded, cheapest first. Empty on a decline. */
  draws: Draw[];
  /** Total drawn from credit tiers — everything except cash. This is a credit issuance. */
  creditCents: number;
  /** What was spendable when the decision was made, for the audit trail. */
  availableCents: number;
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
}

/**
 * Decide one authorization.
 *
 * Declines the whole amount when there isn't enough rather than approving part of it: Lithic
 * supports partial approval via `approved_amount`, but a card that silently pays some of a bill is
 * a worse surprise at a till than one that says no. Making that a product option is a separate
 * decision, not a default.
 */
export function decide({ amountCents, availability, cardPaused }: DecideInput): AuthDecision {
  const available = totalAvailable(availability);

  // Fail closed on a number we cannot reason about. Every comparison against NaN is false, so an
  // availability with a NULL column behind it would slip past the insufficient-funds check and past
  // the defensive remainder check below, and approve an unfunded charge. The one outcome this file
  // exists to prevent.
  if (!Number.isFinite(available) || !Number.isFinite(amountCents)) {
    return { result: 'INSUFFICIENT_FUNDS', draws: [], creditCents: 0, availableCents: 0 };
  }

  if (cardPaused) {
    return { result: 'CARD_PAUSED', draws: [], creditCents: 0, availableCents: available };
  }

  // A zero or negative amount is not a spend; nothing to fund, nothing to refuse.
  if (amountCents <= 0) {
    return { result: 'APPROVED', draws: [], creditCents: 0, availableCents: available };
  }

  if (amountCents > available) {
    return { result: 'INSUFFICIENT_FUNDS', draws: [], creditCents: 0, availableCents: available };
  }

  const { draws, shortfallCents } = drawUpTo(availability, amountCents);

  // Defensive: `available` is the sum of the same numbers the waterfall walks, so this cannot be hit
  // without the two disagreeing. If they ever do, fail closed rather than approve unfunded spend.
  if (shortfallCents > 0) {
    return { result: 'INSUFFICIENT_FUNDS', draws: [], creditCents: 0, availableCents: available };
  }

  const creditCents = draws
    .filter((d) => d.source !== 'cash')
    .reduce((sum, d) => sum + d.amountCents, 0);

  return { result: 'APPROVED', draws, creditCents, availableCents: available };
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
