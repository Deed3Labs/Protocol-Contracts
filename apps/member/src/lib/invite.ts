/*
 * An invite from the Command Center's waitlist (Phase 7b): the email's link carries `?invite=CODE`, and
 * onboarding sends the code back so the sign-up is matched to its invite. It's tracked, not checked:
 * nobody needs a code to join.
 *
 * The link lands before sign-in, and signing in can take the member through another page, so the
 * code is kept on the device until onboarding reads it, for as long as the invite is open (90 days).
 */

const KEY = 'clear.invite';
const OPEN_MS = 90 * 24 * 3600e3;
const CODE = /^[A-Z0-9]{5}-?[A-Z0-9]{5}$/;

/** Keeps the invite code from this page's address, if it has one. Safe to call on every load. */
export function captureInvite(search: string = typeof window === 'undefined' ? '' : window.location.search): void {
  const code = new URLSearchParams(search).get('invite')?.trim().toUpperCase();
  if (!code || !CODE.test(code)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    /* private browsing or storage off: the member can still join, just unmatched */
  }
}

/** The invite code kept on this device, while the invite is open; otherwise empty. */
export function storedInvite(now = Date.now()): string {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { code?: string; at?: number } | null;
    return kept?.code && kept.at && now - kept.at < OPEN_MS && CODE.test(kept.code) ? kept.code : '';
  } catch {
    return '';
  }
}
