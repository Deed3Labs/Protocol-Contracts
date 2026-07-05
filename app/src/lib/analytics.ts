import { IS_LIVE_APP } from './clearNetwork';

/*
 * Plausible analytics — privacy-first, cookieless, and LIVE APP ONLY (app.useclear.org). Dev/preview
 * never load the script, so they can't pollute the dashboard.
 *
 * Uses Plausible's site-specific script (pa-*.js) + plausible.init(). This is a money app, so PII
 * safety is enforced in `transformRequest`, which runs on EVERY event (pageview + custom) before it's
 * sent: we strip all query/hash params and collapse the /claim/:token segment out of the URL. Custom
 * events must still carry coarse names + categories only — NEVER amounts, addresses, emails, phones,
 * or claim tokens.
 *
 * Add `app.useclear.org` as its own site in the (shared) Plausible account — same install as the
 * marketing site, separate dashboard.
 */
const SCRIPT_SRC = 'https://plausible.io/js/pa-two8X6kl9uz0VKoszPaZO.js';

type PlausibleOpts = { props?: Record<string, string | number | boolean> };
type TransformPayload = { u?: string; n?: string } & Record<string, unknown>;
type PlausibleFn = ((event: string, opts?: PlausibleOpts) => void) & {
  q?: unknown[];
  o?: unknown;
  init?: (opts?: unknown) => void;
};

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

let injected = false;

/** Collapse dynamic/sensitive path segments so nothing identifying is sent. Query/hash are dropped separately. */
export function sanitizePath(pathname: string): string {
  let p = (pathname || '/').split('?')[0].split('#')[0];
  // /claim/<token> → /claim/:token — never send the claim token to analytics.
  p = p.replace(/^\/claim\/[^/]+.*$/, '/claim/:token');
  return p || '/';
}

/** Strip query/hash + sensitive path segments from an event's URL. Runs on every event before send. */
function sanitizeRequest(payload: TransformPayload): TransformPayload {
  if (typeof payload.u === 'string') {
    try {
      const url = new URL(payload.u);
      url.search = '';
      url.hash = '';
      url.pathname = sanitizePath(url.pathname);
      payload.u = url.toString();
    } catch {
      /* leave as-is if unparseable */
    }
  }
  return payload;
}

/** Inject the Plausible script once, on the live app only. No-op elsewhere. Safe to call repeatedly. */
export function initAnalytics(): void {
  if (injected || !IS_LIVE_APP || typeof document === 'undefined') return;
  injected = true;
  // Queue stub (Plausible's official snippet) so calls before the script loads are replayed, not lost.
  window.plausible =
    window.plausible ||
    (function (...args: unknown[]) {
      (window.plausible!.q = window.plausible!.q || []).push(args);
    } as PlausibleFn);
  window.plausible.init =
    window.plausible.init ||
    function (i?: unknown) {
      window.plausible!.o = i || {};
    };
  const s = document.createElement('script');
  s.async = true;
  s.src = SCRIPT_SRC;
  document.head.appendChild(s);
  // Auto-captures pageviews (incl. SPA routing); transformRequest scrubs PII from every event's URL.
  window.plausible.init({ transformRequest: sanitizeRequest });
}

/** Fire a custom event. Props must be non-identifying (names/categories only — never amounts/PII). */
export function track(event: string, props?: Record<string, string | number | boolean>): void {
  if (!IS_LIVE_APP || typeof window === 'undefined' || !window.plausible) return;
  window.plausible(event, props ? { props } : undefined);
}
