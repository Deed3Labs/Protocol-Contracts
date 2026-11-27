import { createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';
import type { Queryable } from '../../../db/db.js';
import type { BridgeKyb } from '../kyb/kybService.js';
import { kybStatus } from '../kyb/kybService.js';

/**
 * Shop sign-in for useclear.org: the hand-off that lets a shop check out a hardware pre-order on the
 * marketing site (Deed3Labs/clearpath-website, lib/shop/shopAccount.ts holds the other half).
 *
 *   1. The site's bag sends the owner to merchant.useclear.org/connect?return=…&state=…[&setup=1].
 *   2. The owner signs in here as they always do (or sets the shop up first).
 *   3. The app asks POST /api/merchant/connect/token for a token naming this shop, and goes back to
 *      `return?token=…&state=…`.
 *   4. The site verifies the token against the public half of SHOP_CONNECT_PRIVATE_KEY.
 *
 * The token is a compact JWS, header {"alg":"EdDSA","typ":"JWT"}, Ed25519, valid ten minutes:
 *   aud "useclear.org/shop", sub the shop (its org wallet address), name, owner, email?,
 *   approval "pending" | "approved" | "declined", address?, founding, state, iat, exp.
 *
 * It only ever goes back to an allowlisted return address. Anywhere else, a stranger could start a
 * hand-off with their own `return` and collect a signed token for whoever signs in.
 */

export const AUDIENCE = 'useclear.org/shop';
export const TOKEN_SECONDS = 10 * 60;
/** The one path on the site that takes a token. */
export const RETURN_PATH = '/api/shop/account/return';

export type ShopApproval = 'pending' | 'approved' | 'declined';
export type ShopAddress = { line1: string; line2?: string; city: string; state: string; zip: string; country: string };
export type ShopClaims = { sub: string; name: string; owner: string; email?: string; approval: ShopApproval; address?: ShopAddress; founding: boolean };

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'invalid' | 'not_found',
    readonly status = 422,
  ) {
    super(message);
  }
}

/* ── The key ─────────────────────────────────────────────────────────── */

/**
 * SHOP_CONNECT_PRIVATE_KEY, a PEM Ed25519 private key (`\n` escapes allowed, as Railway stores
 * multi-line values). scripts/generate-shop-connect-key.mjs makes one and prints both halves.
 */
export function signingKey(env = process.env): KeyObject | null {
  const pem = env.SHOP_CONNECT_PRIVATE_KEY;
  if (!pem) return null;
  try {
    const key = createPrivateKey(pem.replace(/\\n/g, '\n'));
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}

/** The public half, as the site's CLEAR_API_PUBLIC_KEY wants it. Public by nature. */
export function publicKeyPem(env = process.env): string | null {
  const key = signingKey(env);
  return key ? (createPublicKey(key).export({ type: 'spki', format: 'pem' }) as string) : null;
}

/* ── Where a token may go ────────────────────────────────────────────── */

const DEFAULT_ORIGINS = ['https://www.useclear.org', 'https://useclear.org'];

/**
 * SHOP_CONNECT_RETURN_ORIGINS, comma-separated, replaces the default (useclear.org and www). Add the
 * site's preview or a localhost origin on the dev API only. The path must be the site's return route
 * exactly, with no query of its own: the app adds token and state, and nothing else rides along.
 */
export function allowedReturn(raw: string, env = process.env): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const origins = (env.SHOP_CONNECT_RETURN_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  const allowed = origins.length ? origins : DEFAULT_ORIGINS;
  if (!allowed.includes(url.origin)) return null;
  if (url.pathname !== RETURN_PATH || url.search || url.hash || url.username || url.password) return null;
  return url;
}

/** The site's one-time value, echoed back in the token. Opaque, but bounded. */
export const validState = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(s);

/* ── What the token says about the shop ──────────────────────────────── */

/**
 * Approval is the business's verification with Bridge, the same one that unlocks withdrawals:
 * verified is approved, rejected (or offboarded) is declined, and everything else, including Bridge
 * being unreachable, is still pending. Pending never refunds anything; only declined does.
 */
export function approvalOf(state: Awaited<ReturnType<typeof kybStatus>>['state']): ShopApproval {
  if (state === 'verified') return 'approved';
  if (state === 'rejected') return 'declined';
  return 'pending';
}

export async function shopApproval(q: Queryable, bridge: BridgeKyb, merchant: string): Promise<ShopApproval | null> {
  const { rows } = await q.query<{ merchant: string }>('SELECT merchant FROM merchant.profiles WHERE merchant = $1', [merchant.toLowerCase()]);
  if (!rows[0]) return null;
  return approvalOf((await kybStatus(q, bridge, rows[0].merchant)).state);
}

/** The claims for a shop, read fresh: the owner signing in, the shop's name, address and standing. */
export async function shopClaims(q: Queryable, bridge: BridgeKyb, merchant: string, staffId: string): Promise<ShopClaims> {
  const m = merchant.toLowerCase();
  const { rows } = await q.query<{
    name: string;
    founding: boolean;
    kyb_email: string | null;
    contact_email: string | null;
    address_line1: string | null;
    address_line2: string | null;
    address_city: string | null;
    address_region: string | null;
    address_postal_code: string | null;
    address_country: string | null;
  }>(
    `SELECT name, founding, kyb_email, contact_email, address_line1, address_line2, address_city, address_region, address_postal_code, address_country
       FROM merchant.profiles WHERE merchant = $1`,
    [m],
  );
  const p = rows[0];
  if (!p) throw new ConnectError('That shop does not exist.', 'not_found', 404);
  const { rows: staff } = await q.query<{ name: string; role: string; email: string | null }>('SELECT name, role, email FROM merchant.staff WHERE id = $1 AND merchant = $2 AND active = true', [
    staffId,
    m,
  ]);
  const owner = staff[0];
  if (!owner || owner.role !== 'owner') throw new ConnectError('Only the shop’s owner can sign it in to useclear.org.', 'invalid', 403);

  const email = owner.email ?? p.kyb_email ?? p.contact_email ?? undefined;
  const address =
    p.address_line1 && p.address_city && p.address_region && p.address_postal_code
      ? {
          line1: p.address_line1,
          ...(p.address_line2 ? { line2: p.address_line2 } : {}),
          city: p.address_city,
          state: p.address_region,
          zip: p.address_postal_code,
          country: p.address_country || 'US',
        }
      : undefined;
  return {
    sub: m,
    name: p.name,
    owner: owner.name,
    ...(email ? { email } : {}),
    approval: approvalOf((await kybStatus(q, bridge, m)).state),
    ...(address ? { address } : {}),
    founding: p.founding === true,
  };
}

/* ── The token ───────────────────────────────────────────────────────── */

const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function mintToken(claims: ShopClaims, state: string, key: KeyObject, now = Math.floor(Date.now() / 1000)): string {
  const header = b64u(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ aud: AUDIENCE, ...claims, state, iat: now, exp: now + TOKEN_SECONDS }));
  return `${header}.${payload}.${b64u(sign(null, Buffer.from(`${header}.${payload}`), key))}`;
}

/** Where the app sends the owner next: the site's return route, carrying the token. */
export function redirectTo(ret: URL, token: string, state: string): string {
  const u = new URL(ret.toString());
  u.searchParams.set('token', token);
  u.searchParams.set('state', state);
  return u.toString();
}
