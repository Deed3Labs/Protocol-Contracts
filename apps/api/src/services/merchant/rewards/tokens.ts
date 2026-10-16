import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { IDENTITY_CODE_SECONDS } from '@clear/merchant-contracts';
import { RewardsError } from './errors.js';

/**
 * Rewards' own tokens (rewards DECISIONS, Phase 1 › Identity and access).
 *
 * A session token is minted from a Privy session and sees one shop, or for the hub only lists shops
 * and mints shop tokens. `requireAuth` takes Privy tokens only, so none of these opens a member route
 * (activity, charges, transfers): the shop's app can't read the member's Clear activity anywhere else.
 *
 * Signed with HMAC-SHA256 under `REWARDS_TOKEN_SECRET`. Short-lived; the app mints again from the
 * Privy session when one runs out.
 */

export interface SessionClaims {
  /** The Privy DID. */
  did: string;
  /** Their smart wallet, lowercased. */
  wallet: string;
  /** A shop's token, or the hub's. */
  scope: { shop: string } | { hub: true };
  /** From the Privy session it was minted from: their own number and email, to match them up. */
  phone?: string | null;
  email?: string | null;
  exp: number;
}

const SESSION_SECONDS = 12 * 60 * 60;
let devSecret: string | null = null;

function secret(): string {
  const s = process.env.REWARDS_TOKEN_SECRET?.trim();
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new RewardsError('Rewards sign-in isn’t set up', 'unavailable');
  // Development and tests: a secret for this process only, so a token never outlives a restart.
  devSecret ??= randomBytes(32).toString('hex');
  return devSecret;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

function verify(token: string, prefix: string): string | null {
  if (!token.startsWith(prefix)) return null;
  const [body, sig] = token.slice(prefix.length).split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(sign(`${prefix}${body}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return Buffer.from(body, 'base64url').toString('utf8');
}

export function mintSession(input: Omit<SessionClaims, 'exp'>, now = new Date()): { token: string; expiresAt: string } {
  const exp = Math.floor(now.getTime() / 1000) + SESSION_SECONDS;
  const body = b64(JSON.stringify({ ...input, wallet: input.wallet.toLowerCase(), exp }));
  return { token: `rws.${body}.${sign(`rws.${body}`)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** The claims, or null for anything forged, expired or not ours. */
export function readSession(token: string, now = new Date()): SessionClaims | null {
  const raw = verify(token, 'rws.');
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as SessionClaims;
    if (typeof c.did !== 'string' || typeof c.wallet !== 'string' || typeof c.exp !== 'number' || !c.scope) return null;
    return c.exp > now.getTime() / 1000 ? c : null;
  } catch {
    return null;
  }
}

/**
 * The signed part of a member's code: `<exp>.<sig>` over the wallet. The wallet alone is public, so
 * adding someone to an order needs this, and it's good for two minutes.
 */
export function mintIdentityId(wallet: string, now = new Date()): { id: string; expiresAt: string } {
  const exp = Math.floor(now.getTime() / 1000) + IDENTITY_CODE_SECONDS;
  const w = wallet.toLowerCase();
  return { id: `${exp}.${sign(`rwi.${w}.${exp}`).slice(0, 22)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function checkIdentityId(wallet: string, id: string, now = new Date()): boolean {
  const [exp, sig] = id.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) <= now.getTime() / 1000) return false;
  const want = Buffer.from(sign(`rwi.${wallet.toLowerCase()}.${exp}`).slice(0, 22));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * A scanned member's code: `…/send?to=<wallet>&id=<signed>`, as rewards' Show my code and the
 * Clear app's Send page draw it. Returns the wallet only when the signed part checks out.
 */
export function walletFromIdentityCode(raw: string, now = new Date()): { wallet: string } | { error: 'not_a_code' | 'unsigned' | 'expired' } {
  let to: string | null = null;
  let id: string | null = null;
  try {
    const u = new URL(raw.trim());
    if (!/\/send\/?$/.test(u.pathname)) return { error: 'not_a_code' };
    to = u.searchParams.get('to');
    id = u.searchParams.get('id');
  } catch {
    return { error: 'not_a_code' };
  }
  if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to)) return { error: 'not_a_code' };
  if (!id) return { error: 'unsigned' };
  return checkIdentityId(to, id, now) ? { wallet: to.toLowerCase() } : { error: 'expired' };
}

/** A random token for a link (the counter's confirm text), and how it's stored. */
export function linkToken(): string {
  return randomBytes(18).toString('base64url');
}
