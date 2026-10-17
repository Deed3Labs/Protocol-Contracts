/**
 * Who may frame `pay.useclear.org/m/:session` (pay spec §5): only the website the session was made for,
 * which the API keeps (`GET /api/checkout/:session/frame`). Anything else, an unknown session, an
 * ended one or an origin that doesn't read cleanly, gets `frame-ancestors 'none'`.
 */

const SESSION = /^ms_[0-9a-f]{32}$/;
/** A bare origin: scheme, host and an optional port. Nothing that could end the directive. */
const ORIGIN = /^https?:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

export const isModalSession = (id: string) => SESSION.test(id);

/** Plain http only for a local test site. */
export function frameableOrigin(origin: unknown): string | null {
  if (typeof origin !== 'string' || !ORIGIN.test(origin)) return null;
  const url = new URL(origin);
  if (url.protocol === 'http:' && !(url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return null;
  return url.origin;
}

export function frameHeaders(origin: string | null): Record<string, string> {
  return {
    'Content-Security-Policy': `frame-ancestors ${origin ?? "'none'"}`,
    // Older browsers without frame-ancestors: no framing at all when there's no website.
    ...(origin ? {} : { 'X-Frame-Options': 'DENY' }),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
  };
}

/** The session's website, or null. Never throws: an API that's down means no framing. */
export async function lookupOrigin(api: string, session: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!api || !isModalSession(session)) return null;
  try {
    const res = await fetcher(`${api}/api/checkout/${session}/frame`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { origin?: unknown };
    return frameableOrigin(body.origin);
  } catch {
    return null;
  }
}
