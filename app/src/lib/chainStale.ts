/**
 * Telling the app that on-chain state it is showing has just been made out of date.
 *
 * A move does not change a member's figures at the moment it confirms. The server still has to
 * pledge the collateral and push the capacities, which are two more writes after the transfer
 * itself lands — so for a few seconds the old limit is genuinely the true one, and the app has no
 * way to be told when the new one arrives.
 *
 * So this refetches on a signal, backing off across a short window, rather than predicting the
 * figure. An optimistic limit would be inventing a number only the contracts get to decide — and
 * it would have hidden the bug where the pledge landed and the push did not.
 *
 * A module rather than three dispatches and four listeners. It already drifted once: the savings
 * move signalled and the pool and bond moves did not, and only Home was listening, so a pool
 * deposit updated a balance and left every figure derived from it stale until the member changed
 * page.
 */
const EVENT = 'clear:chain-stale';

/** How long the server's follow-up writes realistically take, sampled rather than guessed at once. */
const BACKOFF_MS = [3_000, 8_000, 15_000];

/** Say that a move just landed, so anything reading chain state should read it again. */
export function markChainStale(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Re-run `read` after a move, across the window the follow-up writes need.
 *
 * Returns the teardown so a caller can hand it straight back from an effect. Every timer is
 * cleared on unmount: a refetch that fires into a component nobody is looking at is at best waste
 * and at worst a state update on something gone.
 */
export function onChainStale(read: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const timers: ReturnType<typeof setTimeout>[] = [];

  const handle = () => {
    for (const delay of BACKOFF_MS) timers.push(setTimeout(read, delay));
  };
  window.addEventListener(EVENT, handle);

  return () => {
    window.removeEventListener(EVENT, handle);
    for (const timer of timers) clearTimeout(timer);
  };
}
