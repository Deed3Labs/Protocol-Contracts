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
 * The Inland Empire: Riverside and San Bernardino counties.
 *
 * Ranges rather than three-digit prefixes, because three digits are not accurate here. 917xx also
 * covers Pomona, Claremont and La Verne, which are Los Angeles County; 928xx also covers Anaheim
 * and Fullerton, which are Orange County. A prefix list would have told somebody in Anaheim the
 * co-op was open where they live.
 *
 * Each entry is a single ZIP or an inclusive range.
 *
 * SAN BERNARDINO COUNTY
 *   91701, 91708-91710   Alta Loma, Chino, Chino Hills
 *   91729-91739          Rancho Cucamonga, Fontana
 *   91743                Guasti
 *   91758-91764          Ontario
 *   91784-91786          Upland
 *   92242-92286          Needles, Twentynine Palms, Yucca Valley, Joshua Tree
 *   92301-92399          Adelanto, Apple Valley, Barstow, Hesperia, Victorville, Yucaipa
 *   92401-92415          San Bernardino
 *
 * RIVERSIDE COUNTY
 *   92201-92241          Indio, Coachella, Palm Desert, Palm Springs, La Quinta
 *   92501-92599          Riverside, Moreno Valley, Hemet, Perris, Temecula, Murrieta, Corona
 *   92860, 92877-92883   Norco, Corona
 *
 * These are the two counties the reference's copy names, at ZIP-level accuracy. Whether the co-op
 * serves all of both on day one is a business fact this file still does not know -- a launch that
 * starts with, say, Redlands and Riverside only should set CLEAR_SERVED_ZIP_PREFIXES rather than
 * let a member in Needles through.
 */
const INLAND_EMPIRE = [
  '91701', '91708-91710', '91729-91739', '91743', '91758-91764', '91784-91786',
  '92201-92241', '92242-92286',
  '92301-92399', '92401-92415',
  '92501-92599',
  '92860', '92877-92883',
];

export function servedZipPrefixes(): string[] {
  const configured = (process.env.CLEAR_SERVED_ZIP_PREFIXES || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : INLAND_EMPIRE;
}

/** Whether a five-digit ZIP falls inside one entry, which is either a ZIP or an inclusive range. */
function matches(zip: string, entry: string): boolean {
  const [from, to] = entry.split('-');
  if (!to) {
    // A shorter entry is still treated as a prefix, so an operator who sets "923" gets what they
    // plainly meant rather than a list that silently matches nothing.
    return from.length === 5 ? zip === from : zip.startsWith(from);
  }
  return zip >= from && zip <= to;
}

/**
 * Whether a ZIP is inside a served region.
 *
 * An unreadable ZIP is not served. Somebody who typed four digits should be asked again rather
 * than waved through on a prefix that happens to match, and the waitlist is a softer wrong answer
 * than an account in a region the co-op cannot serve.
 */
export function isServedZip(zip: string): boolean {
  const digits = (zip || '').trim().replace(/\D/g, '').slice(0, 5);
  if (digits.length < 5) return false;
  return servedZipPrefixes().some((entry) => matches(digits, entry));
}
