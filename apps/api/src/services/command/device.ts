/**
 * A device's name from its user agent, in the words the Permissions page uses: "Mac", "iPhone",
 * "Laptop" (a Windows, Linux or ChromeOS computer), "Android phone", "iPad". Never the full string,
 * which is close to a fingerprint and says more than the log needs.
 */
export function deviceLabel(ua: string | undefined): string {
  const s = ua ?? '';
  if (/iPad/.test(s) || (/Macintosh/.test(s) && /Mobile\//.test(s))) return 'iPad';
  if (/iPhone|iPod/.test(s)) return 'iPhone';
  if (/Android/.test(s)) return /Mobile/.test(s) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Mac OS X/.test(s)) return 'Mac';
  if (/Windows|Linux|CrOS/.test(s)) return 'Laptop';
  return 'Device';
}

/** A city, as the browser's host reported it; anything that doesn't look like a place name is dropped. */
export function cleanCity(city: unknown): string | null {
  if (typeof city !== 'string') return null;
  let c: string;
  try {
    c = decodeURIComponent(city).trim();
  } catch {
    return null;
  }
  return /^[\p{L}][\p{L} .'’-]{0,59}$/u.test(c) ? c : null;
}
