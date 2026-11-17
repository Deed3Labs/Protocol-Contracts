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
 * Levelled (section 12.9, as TermIssuer schedules it): one payment every cycle,
 * A·r / (1 − (1 + r)^−n), each cycle's carry being r on the principal still unpaid. Over four
 * cycles $940 at 2% is $246.87 a cycle, $18.80 + $14.24 + $9.59 + $4.84 = $47.47 of carry.
 * `planSchedule` (planTerms) is the same schedule in ledger units, to the unit; this is its quick,
 * floating-point form for a chooser that previews every split at once.
 *
 * `In full` is one cycle, not none: the member still holds the balance for a cycle before clearing
 * it, so it costs a single cycle's carry — $18.80 on $940 — unless the chain says it is free (then
 * the rate passed is 0).
 */
export function splitQuote(amount: number, splitInto: number, ratePerCycle: number): SplitQuote {
  const cycles = Math.max(1, splitInto);
  const perCycle = levelPayment(amount, cycles, ratePerCycle);
  const total = perCycle * cycles;
  return {
    splitInto: cycles,
    // What actually leaves the account each cycle: principal and carry together, the same figure
    // every cycle, the way the plan bills.
    perCycle,
    principalPerCycle: amount / cycles,
    carryThisCycle: amount * ratePerCycle,
    carry: total - amount,
    total,
  };
}

/** The level payment that clears `amount` in `cycles` at `ratePerCycle` (a fraction) a cycle. */
export function levelPayment(amount: number, cycles: number, ratePerCycle: number): number {
  const n = Math.max(1, cycles);
  if (ratePerCycle <= 0) return amount / n;
  return (amount * ratePerCycle) / (1 - Math.pow(1 + ratePerCycle, -n));
}
