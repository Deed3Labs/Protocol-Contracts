/*
 * What backs each credit tier — the collateral model, as arithmetic.
 *
 * Pure, so the limits can be tested against the product rules without a chain or a database in the
 * way. Every rate here is a product decision from the spec, not a tunable:
 *
 *   savings-backed   100% of the member's CLRUSD. Their own money, so it backs itself. Free.
 *   asset-backed     95% of what bonds are worth today, 70% of the yield-pool position. Locked
 *                    money that still lends, at the loan-to-value the tier lends at.
 *   income-backed    50% of estimated monthly deposit. Unsecured — nothing stands behind it but
 *                    the next paycheck, which is why it's capped at half of one.
 *   boost            a flat opt-in amount, and zero until it's opted into. An offer is not a limit.
 */

export interface CollateralInputs {
  /** CLRUSD held in the ESA, in cents. */
  savingsCents: number;
  /** Bonds at present value, in cents. */
  bondsWorthCents: number;
  /** Yield-pool position, in cents. */
  poolPositionCents: number;
  /** Estimated monthly deposit, in cents — trailing average, not a promise. */
  monthlyDepositCents: number;
  /** Zero unless the member has taken Boost up. */
  boostLimitCents: number;
}

export const BOND_LTV = 0.95;
export const POOL_LTV = 0.7;
export const INCOME_SHARE = 0.5;

export interface TierLimits {
  savingsCents: number;
  assetCents: number;
  incomeCents: number;
  boostCents: number;
}

export function tierLimits(inputs: CollateralInputs): TierLimits {
  const nonNegative = (n: number) => Math.max(0, Math.round(n));

  return {
    savingsCents: nonNegative(inputs.savingsCents),
    assetCents: nonNegative(
      inputs.bondsWorthCents * BOND_LTV + inputs.poolPositionCents * POOL_LTV,
    ),
    incomeCents: nonNegative(inputs.monthlyDepositCents * INCOME_SHARE),
    boostCents: nonNegative(inputs.boostLimitCents),
  };
}

/**
 * Room left in each tier: the limit less what's already drawn.
 *
 * Never negative. A tier drawn past its limit — which can happen when collateral falls after the
 * draw, a bond maturing or a pool withdrawal — reads as zero room rather than as a negative that
 * would quietly offset another tier's availability in the total.
 */
export function tierAvailability(
  limits: TierLimits,
  used: { savings: number; asset: number; income: number; boost: number },
) {
  return {
    savingsCents: Math.max(0, limits.savingsCents - used.savings),
    assetCents: Math.max(0, limits.assetCents - used.asset),
    incomeCents: Math.max(0, limits.incomeCents - used.income),
    boostCents: Math.max(0, limits.boostCents - used.boost),
  };
}
