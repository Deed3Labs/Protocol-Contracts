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

export interface PayoutSettlement {
  /** Everything the co-op owes the shop for confirmed charges. */
  owed: number;
  /**
   * The part that settles the shop's own Clear balance rather than reaching a bank.
   *
   * A merchant is usually also a member, and a balance they are carrying clears out of what they
   * are owed before anything is transferred. It costs them no carry, which is why it goes first
   * rather than sitting there accruing while a payout lands beside it.
   */
  clearsBalance: number;
  /** What actually reaches the bank account. */
  toBank: number;
}

/**
 * How a payout settles — reference section 07, "How this settles".
 *
 * On $4,210.00 owed with $1,180.00 carried on Clear: $1,180.00 clears the balance and $3,030.00
 * goes to the bank. The two always reconstruct the total, because a merchant checking this against
 * their own books will add them up.
 */
export function payoutSettlement(owed: number, clearBalance: number): PayoutSettlement {
  // A balance larger than the payout clears only as far as the payout goes; the rest stays owed.
  const clearsBalance = Math.min(Math.max(0, clearBalance), Math.max(0, owed));
  return { owed, clearsBalance, toBank: owed - clearsBalance };
}
