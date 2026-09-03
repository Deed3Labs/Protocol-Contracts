/**
 * Split and carry — what a financed charge costs, and what it bills each cycle.
 *
 * Moved here from the member app because the merchant app quotes the same figures at the counter
 * that the member approves on their phone. Computed once, imported by both. The reference values
 * in `split.test.ts` are the contract between the two surfaces.
 */

export interface SplitQuote {
  splitInto: number;
  /**
   * What actually leaves the account each cycle — principal and carry together, levelled across the
   * plan. This is the figure both the shelf row and the chooser show, because it's the only one a
   * member can check against their bank.
   */
  perCycle: number;
  /** The principal alone, before carry. */
  principalPerCycle: number;
  /** Carry for the coming cycle, charged on the whole balance — the cost of holding it once. */
  carryThisCycle: number;
  /** Carry over the life of the plan. */
  carry: number;
  /** What the plan comes to altogether: the amount plus the carry. */
  total: number;
}

/**
 * What a given split costs — design spec §4c, "Choosing the split".
 *
 * Carry accrues by time held and there's no fixed due date, so spreading further always costs more
 * and clearing early always costs less. Stating the total carry per option is what makes the choice
 * honest: the number does the work a warning would otherwise have to.
 *
 * Charged on the balance still outstanding each cycle, which for an even split is the average of
 * what's owed at the start and at the end — hence the (n + 1) / 2 term rather than n. Over four
 * cycles $940 at 2% accrues $18.80 + $14.10 + $9.40 + $4.70 = $47.00.
 *
 * `In full` is one cycle, not none: the member still holds the balance for a cycle before clearing
 * it, so it costs a single cycle's carry — $18.80 on $940. It's the cheapest option, which is what
 * "clearing early always costs less" means; it isn't a free one, and an earlier draft that showed
 * $0.00 there made the plan look like it could be taken and unwound at no cost.
 */
export function splitQuote(amount: number, splitInto: number, ratePerCycle: number): SplitQuote {
  const cycles = Math.max(1, splitInto);
  const carry = amount * ratePerCycle * ((cycles + 1) / 2);
  const total = amount + carry;
  return {
    splitInto: cycles,
    // Levelled, the way an installment plan actually bills: carry declines as the balance does, but
    // the member pays the same figure every cycle rather than a different one each time.
    perCycle: total / cycles,
    principalPerCycle: amount / cycles,
    carryThisCycle: amount * ratePerCycle,
    carry,
    total,
  };
}
