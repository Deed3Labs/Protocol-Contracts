/**
 * Hosts (rewards spec, Phase 7). Clear's own hosts serve every shop at `/s/:slug` and the hub; any
 * other host is one shop's own domain, which serves that shop at `/`. A shop with a verified domain
 * has its `useclear.org/s/:slug` link forward there. The sign-in can't cross to another domain, so
 * on a shop's own domain a customer confirms their number once.
 */

/** Clear's hosts, and the ones a developer or a Vercel preview runs on. */
export function isClearHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === '' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === 'useclear.org' || h.endsWith('.useclear.org') || h.endsWith('.vercel.app');
}

/** `/s/micasa/rewards?x=1` on Clear's host is `https://rewards.micasatacos.com/rewards?x=1` there. */
export function forwardUrl(domain: string, slug: string, pathname: string, search: string): string {
  const rest = pathname.replace(new RegExp(`^/s/${slug}(?=/|$)`), '') || '/';
  return `https://${domain}${rest}${search}`;
}
