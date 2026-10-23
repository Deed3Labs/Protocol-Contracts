/**
 * Command Center access: who sees what (docs/command-reference/command-center-build-prompt.md §3).
 *
 * A level per section: 0 None, 1 Totals (co-op aggregates only), 2 See, 3 Propose, 4 Approve.
 * Effective access is a person's custom levels, else their group's, and never less than the Members
 * row for someone with a Clear account. Turned off, or past an investor's expiry, it's nothing.
 */

export const SECTIONS = ['home', 'growth', 'field', 'members', 'merchants', 'shop', 'money', 'contracts', 'governance', 'records', 'access'] as const;
export type Section = (typeof SECTIONS)[number];
export type Level = 0 | 1 | 2 | 3 | 4;
export type Levels = Record<Section, Level>;

export const NONE = 0,
  TOTALS = 1,
  SEE = 2,
  PROPOSE = 3,
  APPROVE = 4;

export const zero = (): Levels => Object.fromEntries(SECTIONS.map((s) => [s, 0])) as Levels;

/** Levels from the database or a request body, or null when they aren't a full, valid set. */
export function parseLevels(value: unknown): Levels | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== SECTIONS.length || !SECTIONS.every((s) => keys.includes(s))) return null;
  for (const s of SECTIONS) if (!Number.isInteger(v[s]) || (v[s] as number) < 0 || (v[s] as number) > 4) return null;
  return Object.fromEntries(SECTIONS.map((s) => [s, v[s]])) as Levels;
}

export interface AccessInput {
  /** The group's levels, or null for someone with no team group. */
  group: Levels | null;
  custom: Levels | null;
  off: boolean;
  expiresAt: Date | null;
  /** Has a Clear account, so gets at least the Members row. */
  member: boolean;
  members: Levels;
  now: Date;
}

export function effectiveLevels(a: AccessInput): Levels {
  if (a.off) return zero();
  const expired = !!a.expiresAt && a.expiresAt.getTime() <= a.now.getTime();
  const team = expired ? null : (a.custom ?? a.group);
  const base = a.member ? a.members : zero();
  return Object.fromEntries(SECTIONS.map((s) => [s, Math.max(base[s], team?.[s] ?? 0)])) as Levels;
}

/** The sections where `to` gives Approve and `from` didn't: giving any of them needs a second admin. */
export function newApprove(from: Levels, to: Levels): Section[] {
  return SECTIONS.filter((s) => to[s] === APPROVE && from[s] < APPROVE);
}

export const hasAny = (l: Levels) => SECTIONS.some((s) => l[s] > 0);
