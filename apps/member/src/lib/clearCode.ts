/**
 * Reading what a merchant's screen is showing.
 *
 * The QR carries a URL — `https://app.useclear.org/c/55DCQ9PR` — because a code that only this app
 * can open is a code a new customer cannot use, and section 03 of the merchant reference is built
 * around a stranger installing from it. So the payload is a link, and this pulls the charge out of
 * whatever form it arrives in: a full URL, a path, or the eight characters typed by hand.
 *
 * Codes are Crockford base32 — no I, L, O or U — so the letters people confuse with digits cannot
 * appear. That is what makes reading one aloud across a counter survivable, and it means the
 * obvious substitutions can be repaired rather than rejected.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE = new RegExp(`^[${ALPHABET}]{8}$`);

/** I→1, L→1, O→0, U→V: the four the alphabet omits precisely because people mistype them. */
function repair(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/I/g, '1')
    .replace(/L/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

/**
 * Null when there is no charge code in it.
 *
 * Deliberately strict about length: a QR on a counter might be anything — a wifi code, a menu, a
 * rival's app — and opening an approval screen for a charge that does not exist is a worse failure
 * than not recognising the code at all.
 */
export function chargeCodeFrom(payload: string): string | null {
  const text = payload.trim();
  if (!text) return null;

  // A URL or a path: take the segment after /c/.
  const fromPath = /\/c\/([^/?#\s]+)/i.exec(text);
  const candidate = repair(fromPath ? fromPath[1] : text);

  return CODE.test(candidate) ? candidate : null;
}
