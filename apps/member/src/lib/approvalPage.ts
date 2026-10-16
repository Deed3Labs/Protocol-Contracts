/**
 * The approval page (`app.useclear.org/approve/:id`): Pay with Clear's side of the Clear app.
 *
 * A shop's modal opens it with `window.open`, or a text links to it. It reads the payment's
 * `ApprovalView` (no sign-in: it names the shop and the order and nothing about the member), then
 * runs the ordinary charge approval on its `chargeCode`. Pay spec §4's second frame; DECISIONS.md,
 * Phase 1 "Signing in, and one screen for everyone".
 *
 * Everything here is pure, so the rules the page lives by can be tested without a browser.
 */

/** Where the payment came from: the shop's website, or a payment link. */
export type OnlineChannel = 'online' | 'link';

/**
 * `GET /api/checkout/approval/:id`, as `@clear/merchant-contracts` (payPages.ts) defines it. Only the
 * fields this page reads; the contracts are the source.
 */
export interface ApprovalView {
  id: string;
  shop: { name: string; initials: string; logoUrl: string | null; accent: string | null };
  order: {
    lines: { name: string; quantity: number; lineCents: number }[];
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    summary: string;
  };
  channel: OnlineChannel;
  /** The shop's allowed website to go back to, when the payment came from one. */
  returnUrl: string | null;
  chargeCode: string;
}

/** The charge view's `online` (`GET /api/charges/:code`): null at the counter. */
export interface ChargeOnline {
  channel: OnlineChannel;
  shopHost: string | null;
}

export type ApprovalRead =
  | { kind: 'ok'; view: ApprovalView }
  /** 404: no such payment, or it has ended. */
  | { kind: 'gone' }
  /** 409: it has already been paid. */
  | { kind: 'paid' }
  /** Anything else: the network, or the API having a bad moment. */
  | { kind: 'error' };

/**
 * Reads the approval page's payment. No credentials and nothing cached: the page is opened from
 * someone else's site, and a payment's state changes under it.
 */
export async function readApproval(id: string, apiBase: string, fetchImpl: typeof fetch = fetch): Promise<ApprovalRead> {
  try {
    const r = await fetchImpl(`${apiBase}/api/checkout/approval/${encodeURIComponent(id)}`, { cache: 'no-store', credentials: 'omit' });
    if (r.status === 404) return { kind: 'gone' };
    if (r.status === 409) return { kind: 'paid' };
    if (!r.ok) return { kind: 'error' };
    const view = (await r.json()) as ApprovalView;
    if (!view || typeof view.chargeCode !== 'string' || !view.shop?.name) return { kind: 'error' };
    return { kind: 'ok', view };
  } catch {
    return { kind: 'error' };
  }
}

/** The sheet's mono line: "MI CASA TACOS IS ASKING · ONLINE", or "… · LINK" for a payment link. */
export function askingLine(shopName: string, channel: OnlineChannel): string {
  return `${shopName.toUpperCase()} IS ASKING · ${channel === 'online' ? 'ONLINE' : 'LINK'}`;
}

/**
 * "micasatacos.com" from "https://www.micasatacos.com/checkout?x=1". Null for anything that isn't a
 * web address, so a line that names the shop's site is left out rather than naming nonsense.
 */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** The shop's site to name: the charge's own `shopHost` first, then the approval page's `returnUrl`. */
export function shopHostFor(online: ChargeOnline | null | undefined, returnUrl: string | null | undefined): string | null {
  return online?.shopHost || hostOf(returnUrl);
}

/**
 * Whether Over time is shown at all. `false` is the shop's choice (or over time online still off):
 * Pay now only. Null is the counter, whose rules (the $50 minimum) decide as they always have.
 */
export function overTimeShown(overTime: boolean | null | undefined): boolean {
  return overTime !== false;
}

/** The approve button over time: "Approve $185.32 in 4"; one payment is "next cycle". */
export function approveLabel(amountText: string, splitInto: number): string {
  return splitInto === 1 ? `Approve ${amountText} next cycle` : `Approve ${amountText} in ${splitInto}`;
}

/** Under the button: where approving leaves you. Null without a host, and the line is left out. */
export function backOnLine(host: string | null): string | null {
  return host ? `Then you’re back on ${host}` : null;
}

/** When the window won't close itself (DECISIONS, Phase 1): the approved copy. */
export function doneLine(host: string | null): string {
  return host ? `Done. Go back to ${host}` : 'Done. Go back to the shop’s page';
}

/**
 * Signed in with no Clear account behind it. Signing in makes a member record (the profile's
 * bootstrap), so "nobody" and a rewards-only sign-in both read as a member still onboarding.
 */
export function hasNoClearAccount(memberStatus: string | null): boolean {
  return memberStatus === 'ONBOARDING';
}

/**
 * Signed in, but there is no Clear account behind it (a rewards-only sign-in, or nobody): the
 * code they were sent works on the shop's page, and so does a card.
 */
export function noAccountLine(host: string | null, shopName: string): string {
  return `Enter the code we sent you on ${host ?? `${shopName}’s page`}, or pay by card there.`;
}

/**
 * The `returnUrl` hook: honoured only for the payment's own shop website (its origin, exactly).
 * A native app would be handed back this way later; for now nothing calls it but a test.
 */
export function returnUrlAllowed(url: string, allowedReturnUrl: string | null | undefined): boolean {
  if (!allowedReturnUrl) return false;
  try {
    const want = new URL(allowedReturnUrl).origin;
    const got = new URL(url).origin;
    // Opaque origins ("null": custom schemes, data:, file:) are all equal as strings, never as places.
    return want !== 'null' && got === want;
  } catch {
    return false;
  }
}

/** Hands back to `url` when it is the payment's own site. Never called automatically. */
export function handBack(url: string, approval: Pick<ApprovalView, 'returnUrl'>, go: (url: string) => void): boolean {
  if (!returnUrlAllowed(url, approval.returnUrl)) return false;
  go(url);
  return true;
}

/**
 * Close a window that `window.open` made; if it is still open a beat later, say so instead.
 *
 * `window.opener` can't tell us: the shop's script may null it (`noopener`). So it tries, and a
 * browser that refuses (a texted link, a tab nobody's script opened) leaves the window open, which
 * is what the fallback waits for.
 */
export function closeOrFallback(
  win: { close(): void; readonly closed: boolean },
  onFallback: () => void,
  delayMs = 300,
  later: (fn: () => void, ms: number) => unknown = setTimeout,
): void {
  try {
    win.close();
  } catch {
    /* a browser that throws is one that didn't close it */
  }
  later(() => {
    if (!win.closed) onFallback();
  }, delayMs);
}
