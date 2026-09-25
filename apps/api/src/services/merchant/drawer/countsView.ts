import { CountsView, type OwnCount } from '@clear/merchant-contracts';

/**
 * The blind-count projection (card-processing prompt, Phase 2): the only way a count leaves the
 * database. Before every count the shop needs is saved, a viewer gets back their own count and
 * nothing else: not the other person's figure, and not what the drawer should hold. The result is
 * parsed through the contract, whose pre-comparison shapes have nowhere to put either, so even a
 * bug here that attached them would be stripped on the way out.
 */

export interface CountRow {
  id: string;
  counter: string;
  method: 'notes' | 'total';
  notes: Record<string, number> | null;
  total_cents: number | string;
  second: boolean;
  saved_at: Date | string;
}

const own = (r: CountRow): OwnCount => ({
  id: r.id,
  counter: r.counter,
  method: r.method,
  notes: (r.notes as OwnCount['notes']) ?? null,
  totalCents: Number(r.total_cents),
  second: r.second,
  savedAt: new Date(r.saved_at).toISOString(),
});

/**
 * @param live the session's counts that aren't superseded
 * @param viewer the staff member asking
 * @param twoCounts the shop's setting
 * @param expectedCents what the ledger says the drawer holds. Read it only if the counts are all in;
 *   it's a function so a caller can't have computed it for a view that mustn't show it.
 */
export function countsView(input: {
  live: readonly CountRow[];
  viewer: string;
  twoCounts: boolean;
  expectedCents: () => number;
}): CountsView {
  const first = input.live.find((r) => !r.second);
  const second = input.live.find((r) => r.second);
  if (!first) return CountsView.parse({ state: 'awaiting_first' });

  const complete = input.twoCounts ? Boolean(second) : true;
  if (!complete) {
    const mine = first.counter === input.viewer ? own(first) : null;
    return CountsView.parse({ state: 'awaiting_second', mine });
  }

  const counts = second ? ([own(first), own(second)] as const) : ([own(first)] as const);
  const expected = input.expectedCents();
  // The figure that stands is the later count; the two have to agree before a difference is signed.
  const counted = counts[counts.length - 1]!.totalCents;
  const countsAgree = counts.every((c) => c.totalCents === counts[0].totalCents);
  const differenceCents = counted - expected;
  return CountsView.parse({
    state: 'compared',
    counts,
    expectedCents: expected,
    differenceCents,
    countsAgree,
    signoffNeeded: countsAgree && differenceCents !== 0,
  });
}
