/*
 * Where the co-op is open.
 *
 * Operational rather than structural: the reference says regions open when enough people are
 * waiting, so this changes without the product changing. That is why it is configuration read at
 * runtime and not a constant compiled into the app -- opening a region should be an environment
 * variable, not a deploy.
 *
 * Prefix matching rather than a ZIP list. Coverage is counties, and a county is contiguous
 * prefixes; enumerating every ZIP would be a longer list that is wrong in the same places.
 */

/**
 * The Inland Empire, which is where the reference says Clear is starting.
 *
 * Riverside County runs 922xx and 925xx, San Bernardino County 923xx and 924xx, and the western
 * end of San Bernardino County -- Chino, Ontario, Upland -- is 917xx and 918xx.
 *
 * NOT CONFIRMED AGAINST A SERVICE MAP. These are the counties the copy names, translated to
 * prefixes; whether the co-op actually serves all of both counties on day one is a business fact
 * this file does not know. Set CLEAR_SERVED_ZIP_PREFIXES to the real list and this stops being a
 * guess.
 */
const INLAND_EMPIRE = ['917', '918', '922', '923', '924', '925'];

export function servedZipPrefixes(): string[] {
  const configured = (process.env.CLEAR_SERVED_ZIP_PREFIXES || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : INLAND_EMPIRE;
}

/**
 * Whether a ZIP is inside a served region.
 *
 * An unreadable ZIP is not served. Somebody who typed four digits should be asked again rather
 * than waved through on a prefix that happens to match, and the waitlist is a softer wrong answer
 * than an account in a region the co-op cannot serve.
 */
export function isServedZip(zip: string): boolean {
  const digits = (zip || '').trim().replace(/\D/g, '');
  if (digits.length < 5) return false;
  return servedZipPrefixes().some((prefix) => digits.startsWith(prefix));
}
