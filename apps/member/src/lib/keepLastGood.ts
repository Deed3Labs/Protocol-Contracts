/*
 * Prefer a reading that worked over one that did not.
 *
 * A chain read can fail in two ways and both used to overwrite good figures with nothing:
 *
 *   - the request itself fails, and the client helper returns `null`;
 *   - the request succeeds and reports `complete: false`, meaning the server's chain read errored.
 *
 * Neither means "this member has nothing". An empty credit line comes back as a complete result with
 * no tiers. Assigning either on top of a good value blanked every figure on the screen, so under RPC
 * rate limiting the limit dropped to zero and returned on the next success -- not a stale number, a
 * wrong one, flickering. That is what was reported as the credit component showing the wrong thing.
 *
 * Keeping the last good value is honest in a way zero is not: the figures are from a moment ago,
 * which is the ordinary condition of anything read over a network. Zero is a claim about the
 * member's money that was never true at any point.
 *
 * Shared rather than written at each call site, because it is the same rule in four places and the
 * cost of the copies disagreeing is that some screens blank and others do not.
 */
export function keepLastGood<T extends { complete: boolean }>(prev: T | null, next: T | null): T | null {
  // The request failed. There is no new information here at all, only the absence of it.
  if (!next) return prev;
  // A good read always wins, including one that legitimately reports an empty account.
  if (next.complete) return next;
  // Incomplete: keep a good previous reading, but take this one if there is nothing better.
  return prev?.complete ? prev : next;
}
