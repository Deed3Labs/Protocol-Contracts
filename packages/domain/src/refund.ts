/**
 * What a refund does to each party.
 *
 * The writer and the owner see different numbers for the same refund, deliberately — the writer
 * sees what the customer gets back, the owner sees what it does to their payout. Both come from
 * here, so the two screens cannot drift apart.
 *
 * **Carry is not refunded.** A refund unwinds the purchase, not the time: the co-op held the money
 * for the cycles the member had it, and that is what carry pays for. So the member gets back what
 * they paid *less* the carry already accrued, and the merchant gives back the payout they received.
 * The difference between those two figures is the co-op's to absorb.
 *
 * Whole units, not cents — the same convention as `splitQuote` and `money`. The server persists
 * cents (`amountCents`, `payoutCents`); converting at that boundary is the caller's job.
 */

import { merchantPayout } from './merchant';
import { splitQuote } from './split';

export interface RefundQuote {
  /** The charge being unwound. The plan closes at this figure. */
  amount: number;
  /** What returns to the member — to the account it cleared from, so there is nothing to choose. */
  memberReceives: number;
  /** Carry the member already paid, which the co-op keeps. */
  carryKept: number;
  /** What comes off the merchant's next payout: the payout they received for this charge. */
  merchantClawback: number;
  /** The merchant's next payout after the clawback. The figure an owner actually decides on. */
  payoutAfter: number;
}

/**
 * Carry accrued over the cycles already cleared.
 *
 * Charged each cycle on the balance still outstanding at its start, so for an even principal split
 * the k-th cycle carries `amount × rate × (1 − (k−1)/n)`. On $412 at 2% split in 4 that runs
 * $8.24, $6.18, $4.12, $2.06 — summing to the $20.60 `splitQuote` quotes for the whole plan.
 */
export function carryAccrued(
  amount: number,
  splitInto: number,
  ratePerCycle: number,
  cyclesCleared: number,
): number {
  const n = Math.max(1, splitInto);
  const cleared = Math.min(Math.max(0, cyclesCleared), n);
  let carry = 0;
  for (let k = 1; k <= cleared; k++) carry += amount * ratePerCycle * (1 - (k - 1) / n);
  return carry;
}

/**
 * A full refund of a financed charge.
 *
 * Partial refunds are not modelled. The reference leaves them open — whether the plan resizes or
 * closes and reopens at the new amount is unsettled, and resizing is the kinder and much harder
 * answer. Guessing here would put a number in front of a customer that the ledger might not honour.
 *
 * @param nextPayout the merchant's next scheduled payout before this refund.
 */
export function refundQuote(input: {
  amount: number;
  splitInto: number;
  ratePerCycle: number;
  cyclesCleared: number;
  /** The merchant's discount, e.g. 0.025 for 2.5%. */
  discountRate: number;
  nextPayout: number;
}): RefundQuote {
  const { amount, splitInto, ratePerCycle, cyclesCleared, discountRate, nextPayout } = input;

  const { perCycle } = splitQuote(amount, splitInto, ratePerCycle);
  const paid = perCycle * Math.min(Math.max(0, cyclesCleared), Math.max(1, splitInto));
  const carryKept = carryAccrued(amount, splitInto, ratePerCycle, cyclesCleared);

  // What the merchant received for the charge, which is what they give back. Not the charge
  // amount: the co-op's fee was never theirs, so it is not theirs to return.
  const merchantClawback = merchantPayout(amount, discountRate);

  return {
    amount,
    memberReceives: paid - carryKept,
    carryKept,
    merchantClawback,
    payoutAfter: nextPayout - merchantClawback,
  };
}
