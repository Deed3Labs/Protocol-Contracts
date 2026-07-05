import { IS_LIVE_APP } from './clearNetwork';

/*
 * Plausible analytics — privacy-first, cookieless, and LIVE APP ONLY (app.useclear.org). Dev/preview
 * never load the script, so they can't pollute the dashboard.
 *
 * This is a money app, so PII safety is the priority:
 *   - We use the MANUAL script (no automatic pageviews) and send the URL ourselves, after stripping
 *     sensitive path segments (the claim token) AND all query/hash params — nothing identifying leaves
 *     the client.
 *   - Custom events carry coarse names + categories only. NEVER pass amounts, wallet addresses, emails,
 *     phone numbers, or claim tokens as props.
 *
 * Add `app.useclear.org` as its own site in the (shared) Plausible account — same install as the
 * marketing site, separate dashboard.
 */
const DATA_DOMAIN = 'app.useclear.org';
const SCRIPT_SRC = 'https://plausible.io/js/script.manual.js';

type PlausibleOpts = { u?: string; props?: Record<string, string | number | boolean>; callback?: () => void };
type PlausibleFn = ((event: string, opts?: PlausibleOpts) => void) & { q?: unknown[] };

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

let injected = false;

/** Collapse dynamic/sensitive path segments and drop query + hash, so nothing identifying is sent. */
export function sanitizePath(pathname: string): string {
  let p = (pathname || '/').split('?')[0].split('#')[0];
  // /claim/<token> → /claim/:token — never send the claim token to analytics.
  p = p.replace(/^\/claim\/[^/]+.*$/, '/claim/:token');
  return p || '/';
}

/** Inject the Plausible script once, on the live app only. No-op elsewhere. Safe to call repeatedly. */
export function initAnalytics(): void {
  if (injected || !IS_LIVE_APP || typeof document === 'undefined') return;
  injected = true;
  // Queue stub so any track()/pageview fired before the script finishes loading is replayed, not lost.
  window.plausible =
    window.plausible ||
    (function (...args: unknown[]) {
      (window.plausible!.q = window.plausible!.q || []).push(args);
    } as PlausibleFn);
  const s = document.createElement('script');
  s.defer = true;
  s.src = SCRIPT_SRC;
  s.setAttribute('data-domain', DATA_DOMAIN);
  document.head.appendChild(s);
}

/** Send a sanitized pageview (manual script → we pass the URL ourselves). */
export function trackPageview(pathname: string): void {
  if (!IS_LIVE_APP || typeof window === 'undefined' || !window.plausible) return;
  window.plausible('pageview', { u: `https://${DATA_DOMAIN}${sanitizePath(pathname)}` });
}

/** Fire a custom event. Props must be non-identifying (names/categories only — never amounts/PII). */
export function track(event: string, props?: Record<string, string | number | boolean>): void {
  if (!IS_LIVE_APP || typeof window === 'undefined' || !window.plausible) return;
  const u = `https://${DATA_DOMAIN}${sanitizePath(window.location.pathname)}`;
  window.plausible(event, props ? { u, props } : { u });
}
