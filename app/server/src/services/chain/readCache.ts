/*
 * Collapse the identical chain reads a single move sets off.
 *
 * Five things listen for "chain state changed" -- the credit context and the home, savings, earn and
 * card screens -- and each re-reads for itself. The stale signal also retries on a 3s/8s/15s backoff
 * because nothing knows when the follow-up writes land. So one deposit produced up to twenty reads
 * of the same figures, each fanning out to roughly thirty contract calls, and they arrived in
 * synchronised bursts at the same three instants. That is what a rate limiter is built to stop, and
 * it did: reads came back as errors, and a failed read showed the member an empty credit line.
 *
 * Two mechanisms, and the distinction matters:
 *
 * **In-flight sharing** is free correctness-wise. Callers arriving while a read is running attach to
 * it instead of starting another. They are concurrent, so they would have read the same block
 * anyway; there is no version of this where they legitimately see different numbers.
 *
 * **The TTL** is the part that could serve a stale figure, so it is deliberately short and, more
 * importantly, dropped explicitly whenever the server writes to chain. A cached read from just
 * before a pledge landed is exactly the wrong thing to hand the read that was triggered *because*
 * the pledge landed -- which is the bug this whole thread has been about. `invalidate` is called
 * from the collateral announce for that reason, so the settled read always goes to chain.
 */
type Entry = { at: number; value: Promise<unknown> };

const entries = new Map<string, Entry>();

/** Default window. Long enough to cover a burst of listeners, short enough to be uninteresting. */
export const DEFAULT_TTL_MS = 1_000;

export function coalesce<T>(key: string, run: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;

  const value = run();
  entries.set(key, { at: Date.now(), value });
  /*
   * A rejected read must not be cached: the next caller would inherit a failure it could have
   * avoided by simply asking again, which is the opposite of what this is for. Dropped only if the
   * entry is still ours, so a newer read started meanwhile is left alone.
   */
  void value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}

/** Drop everything for one member. Called when the server writes, so the next read goes to chain. */
export function invalidate(prefix: string): void {
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
}

/** Tests only. */
export function resetReadCache(): void {
  entries.clear();
}
