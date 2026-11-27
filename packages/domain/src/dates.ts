/**
 * Calendar dates, parsed as calendar dates.
 *
 * `new Date('2026-12-14')` is parsed by the spec as UTC midnight. Rendered anywhere west of
 * Greenwich it comes back as the 13th — so a payout the shop is told lands on the 14th displays
 * as a day earlier for everyone in the Americas. It is a one-character-looking bug that puts a
 * wrong date in front of a merchant about their money.
 *
 * A payout date is a calendar day, not an instant: "Dec 14" means the 14th wherever you are
 * standing. So parse the parts and build a local date.
 */

/** `2026-12-14` -> a Date at local midnight on that calendar day. */
export function parseCalendarDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** `2026-12-14` -> `Dec 14`. */
export function formatCalendarDate(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
): string {
  return parseCalendarDate(iso).toLocaleDateString('en-US', opts);
}
