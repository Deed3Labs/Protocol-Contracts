import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * The two short-lived things step-up hands out, both signed rather than stored.
 *
 *   challenge -- what the device signs with Face ID. Bound to the member and a purpose, good for two
 *                minutes, used once. Signed so any API instance can check one another issued.
 *   token     -- proof the member just passed Face ID on a credential the server holds. Sent back as
 *                X-Step-Up on the requests that need it, good for two minutes: the same window the
 *                app gives one Face ID check, so the app and the server agree on when to ask again.
 *
 * The key is STEP_UP_SECRET, or one derived from the Privy app secret so nothing new has to be set.
 */

export const STEP_UP_TTL_MS = 2 * 60 * 1000;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;

export type ChallengePurpose = 'register' | 'prove';

function key(): Buffer {
  const own = (process.env.STEP_UP_SECRET || '').trim();
  if (own) return Buffer.from(own, 'utf8');
  const privy = (process.env.PRIVY_APP_SECRET || '').trim();
  if (!privy) throw new Error('Step-up has no key: set STEP_UP_SECRET or PRIVY_APP_SECRET.');
  return createHmac('sha256', privy).update('clear-step-up-v1').digest();
}

const sign = (body: string) => createHmac('sha256', key()).update(body).digest('base64url');

function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The member's id as it appears inside a challenge or token: hashed, so neither carries the DID. */
const who = (userId: string) => createHash('sha256').update(userId).digest('base64url').slice(0, 22);

/*
 * Challenges already answered, until they expire. One instance's memory, so a challenge replayed
 * against a second instance would pass there -- but only with a fresh signature from the member's own
 * device over it, which is the thing being proved anyway.
 */
const answered = new Map<string, number>();

function forgetExpired(now: number): void {
  for (const [c, until] of answered) if (until < now) answered.delete(c);
}

export function issueChallenge(userId: string, purpose: ChallengePurpose, now = Date.now()): string {
  const body = `${purpose}.${who(userId)}.${now + CHALLENGE_TTL_MS}.${randomBytes(16).toString('base64url')}`;
  return Buffer.from(`${body}.${sign(body)}`, 'utf8').toString('base64url');
}

/**
 * True, once, for a challenge this server issued to this member for this purpose and not yet used.
 * `challenge` is the base64url string the browser echoes in clientDataJSON.
 */
export function redeemChallenge(challenge: string, userId: string, purpose: ChallengePurpose, now = Date.now()): boolean {
  let decoded: string;
  try {
    decoded = Buffer.from(challenge, 'base64url').toString('utf8');
  } catch {
    return false;
  }
  const parts = decoded.split('.');
  if (parts.length !== 5) return false;
  const [p, w, exp, nonce, sig] = parts;
  if (!sameSignature(sig, sign(`${p}.${w}.${exp}.${nonce}`))) return false;
  if (p !== purpose || w !== who(userId) || Number(exp) < now) return false;
  forgetExpired(now);
  if (answered.has(challenge)) return false;
  answered.set(challenge, Number(exp));
  return true;
}

export function issueStepUpToken(userId: string, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + STEP_UP_TTL_MS;
  const body = `v1.${who(userId)}.${expiresAt}`;
  return { token: `${body}.${sign(body)}`, expiresAt };
}

export function stepUpTokenValid(token: string | undefined, userId: string, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const [v, w, exp, sig] = parts;
  if (!sameSignature(sig, sign(`${v}.${w}.${exp}`))) return false;
  return w === who(userId) && Number(exp) >= now;
}
