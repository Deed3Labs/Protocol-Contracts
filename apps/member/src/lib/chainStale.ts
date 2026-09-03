/**
 * Telling the app that on-chain state it is showing has changed.
 *
 * Two signals, because there are two things worth saying and they deserve different behaviour.
 *
 * **`markChainStale`** — a move just landed, and the server still has to pledge the collateral and
 * push the capacities. Those are two more writes after the transfer itself, so for a few seconds
 * the old figures are genuinely the true ones. Nothing knows when they finish, so this refetches
 * across a short backoff. It is a guess, and it is wrong in both directions: it reads when nothing
 * has changed, and it gives up before a slow chain is done.
 *
 * **`markChainSettled`** — the server has finished those writes and said so over the socket. No
 * guessing: read once, now. This is the signal that should do the work; the backoff above is what
 * covers a member whose socket is not connected.
 *
 * Neither predicts a figure. An optimistic limit would be inventing a number only the contracts
 * get to decide — and it would have hidden the bug where the pledge landed and the push did not.
 *
 * A module rather than a bare event name, because as a bare name it drifted: one dispatcher, one
 * listener, and nothing to show that four other places needed it.
 */
const STALE = 'clear:chain-stale';
const SETTLED = 'clear:chain-settled';

/** How long the server's follow-up writes realistically take, when nothing can tell us. */
const BACKOFF_MS = [3_000, 8_000, 15_000];

/*
 * A trace, on in dev and off in production.
 *
 * Whether a figure refreshed on its own is not something you can read off the source -- the whole
 * chain is a socket, an event, a listener and a fetch, and every one of them looks correct while
 * being unreachable. Two rounds of this were spent inferring. `?trace=chain` turns it on in a
 * deployed build too, so the answer is one deposit away rather than one deploy away.
 */
const TRACE =
  (typeof import.meta !== 'undefined' && import.meta.env?.DEV) ||
  (typeof window !== 'undefined' && window.location.search.includes('trace=chain'));

function trace(what: string): void {
  if (TRACE) console.debug(`[chain] ${what} @${new Date().toISOString().slice(11, 23)}`);
}

/** A move landed. The figures behind it may not have caught up yet. */
export function markChainStale(): void {
  if (typeof window === 'undefined') return;
  trace('stale — guessing on a backoff');
  window.dispatchEvent(new Event(STALE));
}

/** The server finished the writes behind a move. Read now. */
export function markChainSettled(): void {
  if (typeof window === 'undefined') return;
  trace('settled — server says the writes are done');
  window.dispatchEvent(new Event(SETTLED));
}

/**
 * Re-run `read` when chain state changes, however we come to hear about it.
 *
 * Returns the teardown so a caller can hand it straight back from an effect. Every timer is
 * cleared on unmount: a refetch that fires into a component nobody is looking at is at best waste
 * and at worst a state update on something gone.
 */
export function onChainStale(read: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const timers: ReturnType<typeof setTimeout>[] = [];

  const onGuess = () => {
    for (const delay of BACKOFF_MS) timers.push(setTimeout(() => { trace(`re-read (+${delay}ms guess)`); read(); }, delay));
  };
  // Settled means the writes are already done, so there is nothing to wait for and nothing to
  // schedule — a backoff here would only add three redundant reads after a correct one.
  const onConfirmed = () => { trace('re-read (confirmed)'); read(); };

  window.addEventListener(STALE, onGuess);
  window.addEventListener(SETTLED, onConfirmed);

  return () => {
    window.removeEventListener(STALE, onGuess);
    window.removeEventListener(SETTLED, onConfirmed);
    for (const timer of timers) clearTimeout(timer);
  };
}
