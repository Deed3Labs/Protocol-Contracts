/**
 * Whether the app's reads must come from the network right now, or may be answered from cache.
 *
 * Page switches read through the service worker's cache and refresh behind it, so a page draws its
 * last-known figures at once instead of zeros. That is wrong for a short while after the member
 * does something: the screen re-reads to show the result, and the cache still holds the state from
 * before -- the dispute still open, the balance still owed. So any action opens a window in which
 * reads skip the cache (`cache: 'no-cache'`, which the service worker reads as "network first").
 *
 * A window rather than a single read, because the server keeps writing after a move lands
 * (pledges, capacity pushes, netting) and several screens re-read over the following seconds.
 */
const WINDOW_MS = 60_000;
let freshUntil = 0;

/** Something just changed: read from the network for the next minute. */
export function wantFreshReads(ms = WINDOW_MS): void {
  freshUntil = Math.max(freshUntil, Date.now() + ms);
}

export function readsMustBeFresh(): boolean {
  return Date.now() < freshUntil;
}
