/**
 * What the shop actually receives.
 *
 * One implementation, because the figure appears in three places that must agree: before the
 * charge is raised, at confirmation, and again in a refund when it is clawed back. A merchant who
 * learns their real rate from a monthly statement feels sold to; one who sees the fee as it
 * happens is being told the truth when it is cheapest to hear. That only works if the number is
 * the same all three times.
 */

/** The co-op's cut of a charge, e.g. $23.50 on $940 at 2.5%. */
export function merchantFee(amount: number, discountRate: number): number {
  return amount * discountRate;
}

/** What lands in the shop's payout for a charge — the amount less the fee. */
export function merchantPayout(amount: number, discountRate: number): number {
  return amount - merchantFee(amount, discountRate);
}
