/**
 * Whether the co-op is open where somebody lives.
 *
 * The list comes from the server, because regions open when enough people are waiting — opening
 * one should be a configuration change, not a deploy of the app. Held by a container only for the
 * length of a signup.
 *
 * Shared by both entries rather than copied into each. The two flows disagree about almost
 * everything else, and this is the one rule that must not drift between them: a ZIP that is served
 * at a counter and unserved on the website is a member who gets a different answer depending on
 * how they arrived.
 */

/**
 * Three-way on purpose. `null` means we do not yet know where the co-op serves, which is not the
 * same as it serving nowhere — and defaulting that to "unserved" would put somebody who lives in
 * the region onto a waiting list for it.
 */
export function isServed(zip: string, prefixes: string[] | null): boolean | null {
  if (!prefixes) return null;
  const digits = zip.trim().replace(/\D/g, '');
  if (digits.length < 5) return false;
  return prefixes.some((prefix) => digits.startsWith(prefix));
}
