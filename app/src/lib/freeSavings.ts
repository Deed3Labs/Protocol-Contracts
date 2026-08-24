/**
 * How much of savings is actually free to move.
 *
 * Savings pledged against the credit line cannot leave — the token enforces it at transfer time —
 * so a withdrawal capped at the total balance would offer an amount the chain will refuse. The
 * pledged figure is the SAVINGS tier's collateral, which is the same number the limit breakdown
 * shows, read from the same route.
 *
 * Falls back to the whole balance when credit cannot be read. That is the honest direction to fail:
 * the transfer itself still enforces the real rule, so the worst case is a rejected transaction
 * rather than a member wrongly told their own savings are locked.
 */
export function freeSavings(savingsTotal: number, pledgedCents: number | null): number {
  if (pledgedCents === null) return savingsTotal;
  return Math.max(0, savingsTotal - pledgedCents / 100);
}
