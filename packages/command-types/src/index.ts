/**
 * What the Command Center's app and API share: the shapes the API serves each section in, the
 * figures each section shows, and the seed values for them (the prototype's own numbers, so a
 * seeded database draws exactly what the design draws).
 */
export * from './figures';
export * from './members';

/** The prototype's "today": a seeded database is read as of this day, so its pages match the design. */
export const SEED_TODAY = Date.UTC(2026, 9, 21);
export const DAY = 864e5;

/**
 * A name as the prototype masks it: the first letter, then a dot per letter (two to five). Masking
 * a masked name gives the same name, so the API can mask and the page can mask again.
 */
export function mask(s: string): string {
  return s[0] + '•'.repeat(Math.max(2, Math.min(5, s.length - 1)));
}
