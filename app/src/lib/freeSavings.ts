/**
 * How much of savings may actually leave.
 *
 * This looked like arithmetic — balance minus what is pledged — and it is not. **Encumbrance
 * follows what is drawn, not what is pledged.** Savings pledged against a line nobody has drawn on
 * are entirely free, so that subtraction returns zero and tells a member their own money is locked.
 *
 * Worked through rather than guessed at a second time. What is free is everything not pledged
 * (nothing encumbers it) plus the pledged part not holding up drawn credit:
 *
 *     free = (savings − pledged) + (pledged − required)
 *          = savings − required
 *
 * So the only figure needed is `required`, which the registry calls `encumberedOf` — and that is
 * the same function CLRUSD consults in `_update` to decide whether a transfer may proceed. One
 * source, and it is the enforcing one, so the screen cannot offer an amount the chain refuses or
 * refuse one it would allow.
 *
 * Confirmed on chain: 5 CLRUSD held, all 5 pledged, nothing drawn → `encumberedOf` = 0, so all 5
 * are free. The pledge-subtraction would have said none were.
 */
export function freeSavings(savingsTotal: number, encumberedCents: number | null): number {
  // Unknown is not "none". A failed read must not lock somebody out of their own savings — the
  // transfer still enforces the real rule, so the worst case is a rejected transaction rather
  // than a member wrongly told their money is spoken for.
  if (encumberedCents === null) return savingsTotal;
  return Math.max(0, savingsTotal - encumberedCents / 100);
}
