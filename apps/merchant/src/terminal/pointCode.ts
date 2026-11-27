/**
 * A Point's code from what the tablet's camera read (Add a Point, step 1). The QR on the back of a
 * Point carries its link, `useclear.org/p/A7K2`; its four letters, Crockford base32, are printed
 * under it. The four letters people confuse with digits (I L O U) aren't in the alphabet, so they
 * are read as what was meant.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE = new RegExp(`^[${ALPHABET}]{4}$`);

const repair = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');

/** The code in a Point's QR link, or four letters on their own. Null for anything else. */
export function pointCodeFrom(raw: string): string | null {
  const text = raw.trim();
  const fromLink = /(?:^|\/)p\/([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(text);
  if (fromLink) {
    const c = repair(fromLink[1]!);
    return CODE.test(c) ? c : null;
  }
  // Only four characters and nothing else: a QR that's a URL to somewhere else isn't a Point.
  if (/^[0-9A-Za-z]{4}$/.test(text)) {
    const c = repair(text);
    return CODE.test(c) ? c : null;
  }
  return null;
}
