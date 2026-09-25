import type { CardPlan } from './shop';

/** Card sales under this pay no Clear fee. */
export const CLEAR_CARD_FEE_FLOOR_CENTS = 1000;
/** Clear's fee on a card sale on the free, pay-as-you-go plan. */
export const PAYG_CARD_FEE_CENTS = 30;

/**
 * Clear's fee on one card sale, added as the PaymentIntent's `application_fee_amount`.
 *
 * 0 under $10.00; otherwise 30¢ on pay-as-you-go, or the shop's plan fee on a paid plan (20–25¢,
 * not decided, so a plan setting rather than a constant). Computed on the server only: the client
 * never sends a fee.
 *
 * `amountCents` is the whole card charge, tip included, because that's what the processor charges.
 */
export function clearCardFee(amountCents: number, plan: CardPlan): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new RangeError('amountCents must be a whole, non-negative number of cents');
  if (amountCents < CLEAR_CARD_FEE_FLOOR_CENTS) return 0;
  if (plan.kind === 'payg') return PAYG_CARD_FEE_CENTS;
  if (!Number.isInteger(plan.feeCents) || plan.feeCents < 0) throw new RangeError('A plan fee is a whole, non-negative number of cents');
  return plan.feeCents;
}
