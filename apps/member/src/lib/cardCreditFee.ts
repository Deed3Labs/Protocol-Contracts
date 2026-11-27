/*
 * The card credit fee, as the member is told about it (decision 55).
 *
 * A card purchase that uses credit has a flat 30¢ card credit fee on top, stated plainly. A purchase
 * that carried one shows it on the purchase itself (activityMapping, TransactionDetailDialog); this is
 * the copy for the places that describe it in advance.
 */

/** The fee the member agreements set, in cents: what is quoted while the API has no amount set. */
export const CARD_CREDIT_FEE_QUOTED_CENTS = 30;

/** How the fee reads in a sentence: "30¢", or dollars and cents from a dollar up. */
export function quotedFee(cents: number): string {
  return cents < 100 ? `${cents}¢` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * What card spending from Savings costs, shown before the member allows it (MB-07 §4.3(c)): the APR
 * on savings-backed credit, which carries nothing, and the card credit fee.
 */
export function cardCreditCostLine(fee?: { cents: number; on: boolean } | null): string {
  const cents = fee && fee.cents > 0 ? fee.cents : CARD_CREDIT_FEE_QUOTED_CENTS;
  return `Savings-backed credit is 0% APR: it has no carry. Each card purchase that uses credit has a ${quotedFee(cents)} card credit fee.`;
}
