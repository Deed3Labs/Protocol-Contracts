import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Pay with Clear's secrets at rest (pay prompt, Phase 3's tables).
 *
 * - API secret keys are only ever hashed: the shop is shown one once, and a request is matched by its
 *   hash. They are 24 random base62 characters, so a plain SHA-256 is enough; there is nothing to guess.
 * - Webhook signing secrets and payments' client secrets have to be read back (to sign a delivery, to
 *   hand a payment's secret to the key that reads it), so they are encrypted with AES-256-GCM under
 *   `PAY_SECRETS_KEY` (32 bytes, base64). Production refuses to run without it; elsewhere a key is made
 *   for the process, so anything encrypted is unreadable after a restart, which is fine for development.
 */

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** `n` random base62 characters, without modulo bias. */
export function randomBase62(n: number): string {
  let out = '';
  while (out.length < n) {
    for (const b of randomBytes(n * 2)) {
      if (b < 248) out += BASE62[b % 62];
      if (out.length === n) break;
    }
  }
  return out;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

let devKey: Buffer | null = null;
function key(): Buffer {
  const set = (process.env.PAY_SECRETS_KEY || '').trim();
  if (set) {
    const k = Buffer.from(set, 'base64');
    if (k.length !== 32) throw new Error('PAY_SECRETS_KEY must be 32 bytes, base64');
    return k;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('PAY_SECRETS_KEY is not set');
  return (devKey ??= randomBytes(32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, ct] = stored.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Not an encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

// ---- Payment-scoped tokens ---------------------------------------------------------------------------

/**
 * The frame's sign-in (`X-Pay-Session`): good for one session, for 30 minutes, kept in the frame's
 * memory. `pt.<claims>.<HMAC>`, keyed from `PAY_SECRETS_KEY`. Never a cookie.
 */
export interface PayClaims {
  /** The session. */
  s: string;
  /** sha256 of the confirmed phone or email. */
  c: string;
  /** The member's wallet, when the contact is a member's. */
  w: string | null;
  /** Their first name, for "Hi Sofia". */
  n: string | null;
  exp: number;
}

const macKey = () => createHash('sha256').update('pay-token:').update(key()).digest();
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function mintPayToken(claims: PayClaims): string {
  const body = b64u(JSON.stringify(claims));
  return `pt.${body}.${createHmac('sha256', macKey()).update(body).digest('base64url')}`;
}

export function readPayToken(token: string | undefined, session: string, now = Date.now()): PayClaims | null {
  const m = /^pt\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token ?? '');
  if (!m) return null;
  const want = createHmac('sha256', macKey()).update(m[1]!).digest();
  const got = Buffer.from(m[2]!, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const claims = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8')) as PayClaims;
  return claims.s === session && claims.exp > now ? claims : null;
}
