import Lithic from 'lithic';

/*
 * Lithic client — the banking and card rail (docs.lithic.com). Program Managed: Lithic and its
 * partner bank handle sponsorship, KYC/KYB, AML/BSA, ledgering, manufacturing and network
 * connectivity; we control spend logic and business rules through the API.
 *
 * Inert until LITHIC_API_KEY is set, like every other integration here — nothing runs in dev or
 * prod without real credentials.
 *
 * Sandbox is the default and production takes two keys to reach: LITHIC_ENV=production AND
 * LITHIC_ALLOW_PRODUCTION=true. A single mistyped env var moving real money is the failure mode
 * worth two locks.
 *
 * Facts from the docs that shape the code around this (checked, not assumed):
 *  - Base URLs are https://sandbox.lithic.com/v1 and https://api.lithic.com/v1; the SDK picks them
 *    from `environment`, so nothing here hardcodes a URL.
 *  - Auth is the bare API key in the `Authorization` header — no "Bearer" prefix.
 *  - Customer Financial Accounts are created AUTOMATICALLY when the account holder is created. You
 *    read them back with a list call; you do not POST one. Routing and account numbers are only
 *    populated when the account is routable, which is a program-level configuration.
 *  - Webhooks (including Auth Stream Access) sign with the standard-webhooks scheme —
 *    `webhook-id`, `webhook-timestamp`, `webhook-signature`. The SDK verifies them.
 *  - ASA allows 6 seconds to respond, and Lithic recommends under 3. That is far more room than a
 *    card authorization suggests, and it changes nothing: the auth handler still reads a
 *    precomputed snapshot and never makes an external call.
 */

export type LithicEnvironment = 'sandbox' | 'production';

let client: Lithic | null = null;

function apiKey(): string {
  return (process.env.LITHIC_API_KEY || '').trim();
}

export function lithicEnvironment(): LithicEnvironment {
  const configured = (process.env.LITHIC_ENV || 'sandbox').trim().toLowerCase();
  if (configured !== 'production') return 'sandbox';
  // Second lock: naming production is not enough to reach it.
  if ((process.env.LITHIC_ALLOW_PRODUCTION || '').trim().toLowerCase() !== 'true') {
    throw new Error(
      'LITHIC_ENV=production requires LITHIC_ALLOW_PRODUCTION=true. Refusing to talk to live Lithic.',
    );
  }
  return 'production';
}

export function isConfigured(): boolean {
  return apiKey().length > 0;
}

/** The shared client, or null when the integration isn't configured. Never throws on absence. */
export function getLithic(): Lithic | null {
  if (!isConfigured()) return null;
  if (!client) {
    client = new Lithic({
      apiKey: apiKey(),
      environment: lithicEnvironment(),
      // Lithic rate-limits per second and the SDK retries with backoff; two is enough for the
      // request paths this service uses. The auth-stream handler never calls out at all.
      maxRetries: 2,
    });
  }
  return client;
}

/** For call sites that cannot proceed without it and should fail loudly rather than no-op. */
export function requireLithic(): Lithic {
  const lithic = getLithic();
  if (!lithic) throw new Error('Lithic is not configured (LITHIC_API_KEY missing)');
  return lithic;
}

/** Test seam — drops the memoised client so an env change takes effect. */
export function resetLithicClient(): void {
  client = null;
}
