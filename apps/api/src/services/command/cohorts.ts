import { DAY, type MemberRow } from '@clear/command-types';

/*
 * Growth's Cohorts, live: everyone invited in the same week, from Members' own rows (the waitlist's
 * invites and the member app's accounts). Activated is the first deposit; still active is used Clear
 * in the last 14 days; spent is a first spend at a shop. An account that came without an invite code
 * counts from the week it was opened. Counts only: nothing here says who.
 */

/** Weeks since the invite the grid draws, and how far back "still active" looks. */
export const COHORT_WEEKS = 6;
const ACTIVE_DAYS = 14;
/** Time to activate, in days after the invite: same day, 1–3, 4–7, 1–2 weeks, 2–4 weeks, 4+ weeks. */
const TT_EDGES = [1, 4, 8, 15, 29];
const FUNDS = ['Bank', '$5', 'Deposit'];

export interface CohortWeek {
  /** The Monday the week starts, UTC. */
  start: number;
  /** The batches that invited them; 0 is an account that came without an invite. */
  batches: number[];
  inv: number;
  act: number;
  /** Opened an account, not funded yet. */
  open: number;
  /** Activated and seen in the last 14 days. */
  keep: number;
  /** Activated and spent at a shop. */
  spent: number;
  /** Activated within each week since their invite, cumulative. */
  actBy: number[];
  /** Spent at a shop within each week since their invite, cumulative. */
  spentBy: number[];
}

export interface Cohorts {
  weeks: CohortWeek[];
  /** Activations by time after the invite, in TT_EDGES' buckets. */
  tt: number[];
  /** How they funded: the label, how many, and how many of them are still active. */
  how: [string, number, number][];
  /** The median days from invite to first deposit; null with nobody activated. */
  medianDays: number | null;
}

/** The Monday on or before `t`, UTC (1970-01-05 was one). */
const monday = (t: number) => Math.floor((t - 4 * DAY) / (7 * DAY)) * 7 * DAY + 4 * DAY;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};

export function cohortsOf(rows: MemberRow[], now: number): Cohorts {
  const recent = (m: MemberRow) => m.last_ >= now - ACTIVE_DAYS * DAY;
  const by = new Map<number, MemberRow[]>();
  for (const m of rows) {
    if (!m.invited) continue;
    const w = monday(m.invited);
    by.set(w, [...(by.get(w) ?? []), m]);
  }
  const activated = rows.filter((m) => m.invited && m.activeAt != null);
  const daysTo = (m: MemberRow) => Math.max(0, (m.activeAt! - m.invited) / DAY);
  const weeks = [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, ms]): CohortWeek => {
      const act = ms.filter((m) => m.activeAt != null);
      const within = (t: number | undefined, m: MemberRow, w: number) => t != null && t - m.invited < w * 7 * DAY;
      return {
        start,
        batches: [...new Set(ms.map((m) => m.batch))].sort((a, b) => a - b),
        inv: ms.length,
        act: act.length,
        open: ms.filter((m) => m.status === 'opened').length,
        keep: act.filter(recent).length,
        spent: act.filter((m) => m.spentAt != null).length,
        actBy: Array.from({ length: COHORT_WEEKS }, (_, i) => act.filter((m) => within(m.activeAt, m, i + 1)).length),
        spentBy: Array.from({ length: COHORT_WEEKS }, (_, i) => act.filter((m) => within(m.spentAt, m, i + 1)).length),
      };
    });
  const tt = Array.from({ length: TT_EDGES.length + 1 }, () => 0);
  for (const m of activated) {
    const i = TT_EDGES.findIndex((e) => daysTo(m) < e);
    tt[i < 0 ? TT_EDGES.length : i]++;
  }
  return {
    weeks,
    tt,
    how: FUNDS.map((f): [string, number, number] => {
      const got = activated.filter((m) => m.fund === f);
      return [f, got.length, got.filter(recent).length];
    }),
    medianDays: median(activated.map(daysTo)),
  };
}
