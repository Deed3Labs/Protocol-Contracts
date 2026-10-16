/**
 * Shop sign-in for useclear.org, the merchant app's half (the API's is services/merchant/connect).
 *
 * The site's bag sends an owner to /connect?return=…&state=…[&setup=1] to reserve hardware. They
 * sign in here (or set the shop up first), the API signs a short token naming the shop, and the app
 * goes back to `return` with it. The API checks `return` against its allowlist; this side only
 * keeps the request alive across sign-in and onboarding, which reload the page.
 */

export type ConnectRequest = { return: string; state: string; setup: boolean };

const KEY = 'clear.connect.v1';

/** The request in the address bar, if it is one. */
export function readConnect(search: string): ConnectRequest | null {
  const q = new URLSearchParams(search);
  const ret = q.get('return') ?? '';
  const state = q.get('state') ?? '';
  if (!ret || !state || !/^https?:\/\//.test(ret)) return null;
  return { return: ret, state, setup: q.get('setup') === '1' };
}

/* Kept for this tab only: a pending sign-in should not follow the owner into another tab or a later
   visit. Storage that throws (a private window) just means the request has to stay in the URL. */
export function keepConnect(r: ConnectRequest) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // see above
  }
}

export function pendingConnect(): ConnectRequest | null {
  try {
    const r = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null') as ConnectRequest | null;
    return r && typeof r.return === 'string' && typeof r.state === 'string' ? r : null;
  } catch {
    return null;
  }
}

export function clearConnect() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // see above
  }
}

/** Back to /connect with the request in the URL, after onboarding. */
export const connectPath = (r: ConnectRequest) => `/connect?${new URLSearchParams({ return: r.return, state: r.state })}`;

/** "useclear.org", for the screen to say where the owner is going. */
export function siteName(ret: string): string {
  try {
    return new URL(ret).host.replace(/^www\./, '');
  } catch {
    return 'useclear.org';
  }
}
