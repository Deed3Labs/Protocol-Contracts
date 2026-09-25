import type { StaffRole } from '@clear/domain';
import type { StaffMember } from '@/data/apiClient';

/**
 * Staff, as data — docs/merchant-reference/clear-merchant-staff.html.
 *
 * Who is on the counter now, the week's hours against the shop's opening hours, and the team.
 * The API answers only the team (name, role, charges this month) and the refund limit; shifts and
 * hours have no backend yet (card-processing prompt, Phase 7), so a live shop sees the team, the
 * roles and the limit, and this module's scenario is what the preview shows: Mike's Tire on
 * Tuesday, Sep 22 at 12:16pm.
 */

export interface Mate {
  id: string;
  name: string;
  role: StaffRole;
  /** On shift now. */
  on?: boolean;
  /** When their PIN went in, "8:04am". */
  since?: string;
  /** The booked end, "4:00pm". Absent when the shift was not booked. */
  until?: string;
  /** Booked hours, one block each, and how far through them: 4.27 fills four and 27% of a fifth. */
  hours?: number;
  done?: number;
  /** Holds the tablet: whoever's PIN it is on. */
  holds?: boolean;
  chargesThisMonth?: number;
  /** "Since August" — what a counter shift sees in place of the charge count. */
  joined?: string;
  /** Added and never started a shift: "Added Tuesday". */
  added?: string;
  /** "Mon–Fri, 8am–4pm" */
  usual?: string;
  /** "Today, 8:04am" */
  lastShift?: string;
}

// ---- Time --------------------------------------------------------------------------------------

/** Hours since midnight, as fractions: 12:10pm is 12.1667. */
export type Hour = number;

/** "8am", "12pm", "4pm", or "12:10pm" when it is not on the hour. */
export function clock(h: Hour, minutes = false): string {
  const whole = Math.floor(h);
  const m = Math.round((h - whole) * 60);
  const t = `${whole % 12 || 12}${m || minutes ? `:${String(m).padStart(2, '0')}` : ''}`;
  return `${t}${whole < 12 || whole === 24 ? 'am' : 'pm'}`;
}

/** "4" for a gap's ends and the axis's middle ticks: no am or pm. */
const bare = (h: Hour) => String(Math.floor(h) % 12 || 12);

/** "8am–4pm" */
export const span = (a: Hour, b: Hour) => `${clock(a)}–${clock(b)}`;

// ---- The week ----------------------------------------------------------------------------------

export interface ShopDay {
  /** "Mon", "Tuesday", 22 */
  short: string;
  long: string;
  date: number;
  /** Opening hours, or null when the shop is closed. */
  open: [Hour, Hour] | null;
}

export interface Week {
  /** "Sep 21 – 27" */
  label: string;
  days: ShopDay[];
  /** Index of today in `days`, and the time now. */
  today: number;
  now: Hour;
  /** Booked hours, by person and day. */
  booked: Record<string, ([Hour, Hour] | null)[]>;
  /** A shift somebody started without being booked: from when, today. */
  unbooked?: Record<string, Hour>;
}

export type Seg = { cls: string; left: number; width: number };

const pct = (x: number) => Math.round(x * 1000) / 10;

/** Where a day's opening hours are covered by at least one booking, and where not. */
export function cover(week: Week, day: number): { cov: Seg[]; gap: Seg[]; gaps: [Hour, Hour][]; full: boolean; none: boolean } {
  const open = week.days[day].open;
  if (!open) return { cov: [], gap: [], gaps: [], full: false, none: false };
  const [a, b] = open;
  const spans = Object.values(week.booked)
    .map((d) => d[day])
    .filter((s): s is [Hour, Hour] => !!s)
    .map(([s, e]) => [Math.max(a, s), Math.min(b, e)] as [Hour, Hour])
    .filter(([s, e]) => e > s)
    .sort((x, y) => x[0] - y[0]);
  const merged: [Hour, Hour][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const gaps: [Hour, Hour][] = [];
  let at = a;
  for (const [s, e] of merged) {
    if (s > at) gaps.push([at, s]);
    at = Math.max(at, e);
  }
  if (at < b) gaps.push([at, b]);
  const len = b - a;
  const seg = (cls: string) => ([s, e]: [Hour, Hour]) => ({ cls, left: pct((s - a) / len), width: pct((e - s) / len) });
  const full = gaps.length === 0;
  return {
    cov: merged.map(seg(full ? 'cov full' : 'cov')),
    gap: gaps.map(seg('gap')),
    gaps,
    full,
    none: merged.length === 0,
  };
}

/** The axis: every two hours on a long day, every hour on a short one; the ends say am or pm. */
export function ticks(open: [Hour, Hour], nowF?: number): { label: string; left: number; mid: boolean }[] {
  const [a, b] = open;
  const len = b - a;
  const step = len >= 8 ? 2 : 1;
  const out: { label: string; left: number; mid: boolean }[] = [];
  for (let h = a; h <= b; h += step) {
    const end = h === a || h === b;
    const left = pct((h - a) / len);
    // The now marker's own label sits over the axis; a tick it would cover is left out.
    if (!end && nowF !== undefined && Math.abs(left - nowF * 100) < 5) continue;
    out.push({ label: end ? clock(h) : bare(h), left, mid: !end });
  }
  return out;
}

/** One faint line an hour. */
export const gridLines = (open: [Hour, Hour]) =>
  Array.from({ length: open[1] - open[0] - 1 }, (_, i) => Math.round(((i + 1) / (open[1] - open[0])) * 10000) / 100);

/** Hours booked across the week. */
export const weekHours = (d: ([Hour, Hour] | null)[]) => d.reduce((t, s) => t + (s ? s[1] - s[0] : 0), 0);

/** "Nobody booked Saturday, and gaps on 3 days" */
export function gapLine(week: Week): string | null {
  const nobody: string[] = [];
  let partial = 0;
  week.days.forEach((d, i) => {
    if (!d.open) return;
    const c = cover(week, i);
    if (c.none) nobody.push(d.long);
    else if (!c.full) partial++;
  });
  const g = partial ? `gaps on ${partial} ${partial === 1 ? 'day' : 'days'}` : '';
  if (nobody.length) return `Nobody booked ${nobody.join(' or ')}${g ? `, and ${g}` : ''}`;
  return g ? g[0].toUpperCase() + g.slice(1) : null;
}

/** "4–6 open", "12–2 open", "Covered", "Nobody booked" */
export function coverLine(week: Week, day: number): { t: string; cls: 'gap' | 'ok' } {
  const c = cover(week, day);
  if (c.full) return { t: 'Covered', cls: 'ok' };
  if (c.none) return { t: 'Nobody booked', cls: 'gap' };
  return { t: `${c.gaps.map(([s, e]) => `${bare(s)}–${bare(e)}`).join(', ')} open`, cls: 'gap' };
}

// ---- Hours, as the sheet edits them -------------------------------------------------------------

export const DAY_KEYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const dayName = (i: number) => DAY_LONG[i];

export interface Hours {
  days: boolean[];
  start: Hour;
  end: Hour;
  /** Days with their own hours. */
  own: Record<number, [Hour, Hour]>;
}

/** "Mon–Fri", "Thu off", "Mon, Wed, Fri" */
export function daysLabel(days: boolean[]): string {
  const on = days.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
  if (!on.length) return 'No days';
  const first = on[0];
  const last = on[on.length - 1];
  if (on.length === 1) return DAY_SHORT[first];
  if (last - first + 1 === on.length) return `${DAY_SHORT[first]}–${DAY_SHORT[last]}`;
  const off = Array.from({ length: last - first + 1 }, (_, k) => first + k).filter((i) => !days[i]);
  if (off.length === 1) return `${DAY_SHORT[off[0]]} off`;
  return on.map((i) => DAY_SHORT[i]).join(', ');
}

export function hoursTotal(h: Hours): number {
  return h.days.reduce((t, on, i) => {
    if (!on) return t;
    const [s, e] = h.own[i] ?? [h.start, h.end];
    return t + (e - s);
  }, 0);
}

/** "8:00am" */
export const time = (h: Hour) => clock(h, true);

// ---- From the API -------------------------------------------------------------------------------

/**
 * The team from what the API answers: the roster and each person's charges this month. The person
 * holding the tablet is on; nothing else about shifts is known yet.
 */
export function teamFromApi(staff: StaffMember[], holderId: string): Mate[] {
  return staff
    .filter((s) => s.active)
    .map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      holds: s.id === holderId,
      on: s.id === holderId,
      chargesThisMonth: s.chargesThisMonth,
    }));
}

// ---- The reference scenario ---------------------------------------------------------------------

const JEN: Mate = { id: 'jen', name: 'Jen R.', role: 'counter', on: true, since: '8:04am', until: '4:00pm', hours: 8, done: 4.27, chargesThisMonth: 18, joined: 'Since August', usual: 'Mon–Fri, 8am–4pm', lastShift: 'Today, 8:04am' };
const LUIS: Mate = { id: 'luis', name: 'Luis M.', role: 'manager', on: true, since: '8:12am', until: '2:00pm', hours: 6, done: 4.27, chargesThisMonth: 11, joined: 'Since August', usual: 'Tue–Fri, 8am–2pm', lastShift: 'Today, 8:12am' };
const MIKE: Mate = { id: 'mike', name: 'Mike R.', role: 'owner', on: true, since: '12:10pm', chargesThisMonth: 2, joined: 'Since August', lastShift: 'Today, 12:10pm' };
const ANA: Mate = { id: 'ana', name: 'Ana Ruiz', role: 'counter', added: 'Added Tuesday' };

export interface StaffScenario {
  /** On the counter now, the holder first. */
  crew: Mate[];
  team: Mate[];
  week: Week;
  limitCents: number;
  maxCents: number;
}

const WEEK: Week = {
  label: 'Sep 21 – 27',
  today: 1,
  now: 12 + 16 / 60,
  days: [
    { short: 'Mon', long: 'Monday', date: 21, open: [8, 18] },
    { short: 'Tue', long: 'Tuesday', date: 22, open: [8, 18] },
    { short: 'Wed', long: 'Wednesday', date: 23, open: [8, 18] },
    { short: 'Thu', long: 'Thursday', date: 24, open: [8, 18] },
    { short: 'Fri', long: 'Friday', date: 25, open: [8, 16] },
    { short: 'Sat', long: 'Saturday', date: 26, open: [9, 14] },
    { short: 'Sun', long: 'Sunday', date: 27, open: null },
  ],
  booked: {
    jen: [[8, 16], [8, 16], [8, 16], [8, 12], [8, 16], null, null],
    luis: [null, [8, 14], [8, 14], [14, 18], [8, 14], null, null],
    mike: [[8, 12], null, [14, 18], null, null, null, null],
  },
  unbooked: { mike: 12 + 10 / 60 },
};

/** The owner's tablet: Mike holds it; Jen and Luis are on. */
export const OWNER_VIEW: StaffScenario = {
  crew: [{ ...MIKE, holds: true }, JEN, LUIS],
  team: [JEN, LUIS, MIKE, ANA],
  week: WEEK,
  limitCents: 50000,
  maxCents: 150000,
};

/** Jen's counter shift. The reference draws two on here, without Mike. */
export const COUNTER_VIEW: StaffScenario = {
  ...OWNER_VIEW,
  crew: [{ ...JEN, holds: true }, LUIS],
};

/** First thing: Jen alone. */
export const FIRST_THING: Mate[] = [{ ...JEN, holds: true, done: 0.4 }];

/** A busy Saturday, six on. */
export const BUSY_SATURDAY: Mate[] = [
  { ...LUIS, since: '9:52am', until: '4:00pm', hours: 6, done: 2.4, holds: true },
  { ...JEN, since: '11:58am', until: '4:00pm', hours: 4, done: 0.3 },
  { ...ANA, on: true, since: '9:55am', until: '2:00pm', hours: 4, done: 2.4 },
  { ...MIKE, since: '10:30am' },
  { id: 'dee', name: 'Dee P.', role: 'counter', on: true, since: '10:00am', until: '4:00pm', hours: 6, done: 2.4 },
  { id: 'sam', name: 'Sam T.', role: 'counter', on: true, since: '12:00pm', until: '4:00pm', hours: 4, done: 0.25 },
];

/** Jen's usual hours, and this week's with Thursday off. */
export const JEN_HOURS: Hours = { days: [true, true, true, true, true, false, false], start: 8, end: 16, own: {} };
export const JEN_THIS_WEEK: Hours = { ...JEN_HOURS, days: [true, true, true, false, true, false, false] };
export const JEN_FRIDAY_SHORT: Hours = { ...JEN_HOURS, own: { 4: [8, 12] } };
