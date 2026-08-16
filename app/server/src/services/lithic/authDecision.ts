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

  const draws: Draw[] = [];
  let remaining = amountCents;

  for (const source of TIER_ORDER) {
    if (remaining <= 0) break;
    const room = Math.max(0, availableIn(availability, source));
    if (room <= 0) continue;
    const take = Math.min(room, remaining);
    draws.push({ source, amountCents: take });
    remaining -= take;
  }

  // Defensive: `available` is the sum of the same numbers the loop walks, so this cannot be hit
  // without the two disagreeing. If they ever do, fail closed rather than approve unfunded spend.
  if (remaining > 0) {
    return { result: 'INSUFFICIENT_FUNDS', draws: [], creditCents: 0, availableCents: available };
  }

  const creditCents = draws
    .filter((d) => d.source !== 'cash')
    .reduce((sum, d) => sum + d.amountCents, 0);

  return { result: 'APPROVED', draws, creditCents, availableCents: available };
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
