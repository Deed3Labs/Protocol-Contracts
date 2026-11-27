import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/*
 * Umami analytics: the co-op's own, self-hosted and cookie-free, and on the live app only
 * (merchant.useclear.org), so local dev and previews never count. The Command Center's Growth › Apps
 * reads them back through Umami's API.
 *
 * The tracker's address goes in VITE_UMAMI_SRC (https://…/script.js on the co-op's Umami) and the app's
 * id in VITE_UMAMI_WEBSITE_ID, from the merchant.useclear.org website in Umami's settings. Nothing
 * loads without them.
 *
 * Page views are counted only on shift, inside AppShell (usePageViews), so a day's visitors are the
 * tablets and computers a shop used that day. Every event leaves through `beforeSend`: no query, no
 * hash, no page title, and the ids in an address collapsed (/charges/:id). Nothing about a sale, a
 * customer or a staff member is ever sent. Errors go up as their page and kind
 * ("Error · /new · TypeError"), never their message.
 */

type Payload = { url?: string; referrer?: string; title?: string } & Record<string, unknown>;
type Props = Record<string, string | number | boolean>;
type Umami = { track: (event?: string | ((p: Payload) => Payload), data?: Props) => void };

declare global {
  interface Window {
    umami?: Umami;
    clearUmamiBeforeSend?: (type: string, payload: Payload) => Payload;
  }
}

const LIVE_HOST = 'merchant.useclear.org';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Errors sent from one page load at most: a loop that throws shouldn't flood the numbers. */
const MAX_ERRORS = 5;

const live = () => typeof window !== 'undefined' && window.location.hostname === LIVE_HOST;
let injected = false;
let errorsSent = 0;
// what was tracked before the script arrived, sent once it has
const queue: Array<(u: Umami) => void> = [];

/** The tracker, only from an https address ending in .js, and the app's id, only as a uuid. */
export function tracker(src: string | undefined, id: string | undefined): { src: string; id: string } | null {
  const s = src?.trim(),
    i = id?.trim();
  if (!s || !i || !ID.test(i)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.search && !u.hash && u.pathname.endsWith('.js') ? { src: u.toString(), id: i } : null;
  } catch {
    return null;
  }
}

/** A path with its ids collapsed: /charges/8f2… → /charges/:id, /inventory/12/variants → /inventory/:id/:sub. */
export function sanitizePath(pathname: string): string {
  const p = (pathname || '/').split('?')[0].split('#')[0];
  return (
    p
      .replace(/^\/r\/[^/]+.*$/, '/r/:token')
      .replace(/^\/(charges|payouts)\/(?!:)[^/]+/, '/$1/:id')
      .replace(/^\/inventory\/[^/]+(\/[^/]+)?.*$/, (_m, sub) => (sub ? '/inventory/:id/:sub' : '/inventory/:id')) || '/'
  );
}

function cleanUrl(u: string): string {
  try {
    const url = new URL(u, `https://${LIVE_HOST}`);
    return url.origin + sanitizePath(url.pathname);
  } catch {
    return sanitizePath(u);
  }
}

/** Every event, before it leaves: the address and the one it came from cleaned, no page title. */
export function beforeSend(_type: string, payload: Payload): Payload {
  return {
    ...payload,
    ...(typeof payload.url === 'string' ? { url: cleanUrl(payload.url) } : {}),
    ...(typeof payload.referrer === 'string' && payload.referrer ? { referrer: cleanUrl(payload.referrer) } : {}),
    title: 'Clear for shops',
  };
}

function send(f: (u: Umami) => void): void {
  if (!live()) return;
  try {
    if (window.umami) f(window.umami);
    else if (injected) queue.push(f);
  } catch {
    /* analytics never gets in the way of the counter */
  }
}

const kindOf = (e: unknown) => (e instanceof Error && /^[A-Za-z]{1,30}$/.test(e.name) ? e.name : 'Error');

/** An error, as its page and kind. Names are capped at Umami's 50 characters. */
export function trackError(e: unknown): void {
  if (errorsSent >= MAX_ERRORS || typeof window === 'undefined') return;
  errorsSent++;
  send((u) => u.track(`Error · ${sanitizePath(window.location.pathname)} · ${kindOf(e)}`.slice(0, 50)));
}

/** Load the tracker once, on the live app only, when it's configured. Safe to call repeatedly. */
export function initAnalytics(): void {
  if (injected || !live() || typeof document === 'undefined') return;
  const t = tracker(import.meta.env.VITE_UMAMI_SRC as string | undefined, import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined);
  if (!t) return;
  injected = true;
  window.clearUmamiBeforeSend = beforeSend;
  const s = document.createElement('script');
  s.defer = true;
  s.src = t.src;
  s.dataset.websiteId = t.id;
  s.dataset.domains = LIVE_HOST;
  // page views are sent on shift (usePageViews), not on the sign-in or enrollment screens
  s.dataset.autoTrack = 'false';
  s.dataset.excludeSearch = 'true';
  s.dataset.excludeHash = 'true';
  s.dataset.beforeSend = 'clearUmamiBeforeSend';
  s.onload = () => {
    const u = window.umami;
    if (u) queue.splice(0).forEach((f) => f(u));
  };
  document.head.appendChild(s);
  window.addEventListener('error', (ev) => trackError(ev.error));
  window.addEventListener('unhandledrejection', (ev) => trackError(ev.reason));
}

/** A custom event: a name and coarse categories only, never anything about a sale or a person. */
export function track(event: string, props?: Props): void {
  send((u) => u.track(event, props));
}

/** Count a page view for each page of the counter app as it's shown. */
export function usePageViews(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    send((u) => u.track((p) => ({ ...p, url: sanitizePath(pathname) })));
  }, [pathname]);
}
