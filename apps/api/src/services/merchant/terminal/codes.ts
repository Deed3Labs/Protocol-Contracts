import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Codes people read and type: Crockford base32 (no I, L, O or U), so a 0 can't be read as an O.
 * A Point's code is four of them; a receipt's is ten, which is about 10^15, too many to guess.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function crockford(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** A secret handed over once (a Point's provisioning secret, its device key). Only its hash is kept. */
export const secret = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
