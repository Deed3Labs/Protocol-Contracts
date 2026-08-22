/**
 * Reading a shop's code.
 *
 * The counter path begins with a camera pointed at a sticker, so everything the flow knows before
 * a member types anything comes from a URL — which means it comes from whoever wrote the URL.
 * These two functions are that boundary, which is why they live apart from the container and are
 * tested directly.
 */

/** `mikes-tire` → `Mike's Tire` is not recoverable; `Mikes Tire` is honest and close enough. */
export function shopDisplayName(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The total from the code, if there is one and it is sane.
 *
 * Null rather than zero when absent: a shop's printed sticker carries no sale, and "no pending
 * total" is a different screen from "a pending total of nothing".
 *
 * The ceiling is not a limit on what a member can be lent. It is a bound on what an arbitrary URL
 * is allowed to put on somebody's screen — the amount here can motivate a signup and must never
 * authorize a debt, and the container is what enforces the second half.
 */
export function parsePendingTotal(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 100_000) return null;
  return Math.round(value * 100) / 100;
}
