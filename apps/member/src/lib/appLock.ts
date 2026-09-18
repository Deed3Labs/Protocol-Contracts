/*
 * When the app last saw the member — the clock behind the lock.
 *
 * Kept in localStorage rather than memory so a PWA that was killed in the background and reopened
 * later still locks: that is the commonest way somebody comes back to a banking app, and an
 * in-memory timer would have been reset by it.
 *
 * Holds a timestamp and nothing else. It decides whether to draw the lock screen; it grants nothing.
 */
const KEY = 'clear:last-active';

/** Idle, or away, for this long and the app locks. Banking apps sit between two and ten minutes. */
export const LOCK_AFTER_MS = 5 * 60 * 1000;

export function markActive(at = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(at));
  } catch {
    /* no storage — the in-memory idle timer still locks an app left open */
  }
}

export function lastActive(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** Signing out ends the session, so the next sign-in — wherever it happens — starts unlocked. */
export function forgetActive(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}

/**
 * Whether a session last seen at `at` should open locked.
 *
 * Never seen counts as fresh, not stale: it means this sign-in has not been recorded yet (a claim
 * link or counter onboarding that signed in without passing the login screen), and locking a member
 * seconds after they signed in would be the lock getting in the way, not doing its job.
 */
export function isStale(at: number | null, now = Date.now()): boolean {
  return at !== null && now - at >= LOCK_AFTER_MS;
}
