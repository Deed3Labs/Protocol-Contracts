/*
 * The bank's settlement calendar, as configuration (decision 54). Pure: no clock, no network.
 *
 * The Credit Settlement Account (CSA) is debited at a settlement cut-off on each business day. What
 * the owner fills in later is all here: the cut-off time and its time zone, which weekdays are
 * business days, the holidays, and how many business days after clearing a card transaction is
 * settled with the bank. Nothing in it is hard-coded beyond a placeholder default.
 *
 * Times are unix seconds. Dates are the cut-off's local calendar dates, "YYYY-MM-DD".
 */

export interface CutoffSchedule {
  /** IANA zone the cut-off time is in, e.g. America/New_York. */
  timeZone: string;
  /** Local cut-off time, minutes after midnight. */
  cutoffMinutes: number;
  /** Business weekdays, 0 = Sunday ... 6 = Saturday. */
  businessDays: number[];
  /** Local dates with no settlement. */
  holidays: string[];
  /**
   * Business days between a card transaction clearing (Lithic SETTLED) and the cut-off whose
   * settlement debits it. 0: cleared before a cut-off is debited at that cut-off.
   */
  lagDays: number;
}

export const DEFAULT_SCHEDULE: CutoffSchedule = {
  timeZone: 'America/New_York',
  cutoffMinutes: 14 * 60,
  businessDays: [1, 2, 3, 4, 5],
  holidays: [],
  lagDays: 0,
};


/** The zone's local wall-clock parts at an instant. */
function localParts(t: number, timeZone: string): { y: number; m: number; d: number; hh: number; mm: number; weekday: number } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour) % 24, mm: Number(p.minute), weekday };
}

/** The instant a local wall-clock time happens in a zone (the first one, across a DST change). */
export function zonedInstant(date: string, minutes: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60) / 1000;
  let t = wall;
  for (let i = 0; i < 3; i++) {
    const p = localParts(t, timeZone);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) / 1000;
    const diff = wall - seen;
    if (diff === 0) break;
    t += diff;
  }
  return t;
}

/** The local date of an instant. */
export function localDate(t: number, timeZone: string): string {
  const p = localParts(t, timeZone);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** The calendar date `n` days after `date`. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isBusinessDay(date: string, s: CutoffSchedule): boolean {
  return s.businessDays.includes(weekdayOf(date)) && !s.holidays.includes(date);
}

/** The first business day on or after `date`. */
export function businessDayOnOrAfter(date: string, s: CutoffSchedule): string {
  let d = date;
  for (let i = 0; i < 366; i++, d = addDays(d, 1)) if (isBusinessDay(d, s)) return d;
  throw new Error('No business day within a year: check SETTLEMENT_BUSINESS_DAYS and SETTLEMENT_HOLIDAYS.');
}

/** `n` business days after the business day `date` (0: `date` itself, moved to a business day). */
export function addBusinessDays(date: string, n: number, s: CutoffSchedule): string {
  let d = businessDayOnOrAfter(date, s);
  for (let i = 0; i < n; i++) d = businessDayOnOrAfter(addDays(d, 1), s);
  return d;
}

export function cutoffOn(date: string, s: CutoffSchedule): number {
  return zonedInstant(date, s.cutoffMinutes, s.timeZone);
}

/** The first cut-off strictly after `t`. */
export function nextCutoff(t: number, s: CutoffSchedule): number {
  let d = localDate(t, s.timeZone);
  for (let i = 0; i < 400; i++, d = addDays(d, 1)) {
    if (!isBusinessDay(d, s)) continue;
    const c = cutoffOn(d, s);
    if (c > t) return c;
  }
  throw new Error('No cut-off within a year.');
}

/** The last cut-off at or before `t`. */
export function previousCutoff(t: number, s: CutoffSchedule): number {
  let d = localDate(t, s.timeZone);
  for (let i = 0; i < 400; i++, d = addDays(d, -1)) {
    if (!isBusinessDay(d, s)) continue;
    const c = cutoffOn(d, s);
    if (c <= t) return c;
  }
  throw new Error('No cut-off within a year.');
}

/** The cut-off at which a card transaction that cleared at `t` is debited from the CSA. */
export function dueCutoffFor(t: number, s: CutoffSchedule): number {
  const first = nextCutoff(t - 1, s); // a clearing at exactly a cut-off belongs to it
  if (!s.lagDays) return first;
  return cutoffOn(addBusinessDays(localDate(first, s.timeZone), s.lagDays, s), s);
}

export interface Coverage {
  /** The next cut-off. */
  next: number;
  /**
   * The last cut-off this run funds for. The next one, unless non-business days follow it (a
   * Friday, or the day before a holiday): then the first business day's cut-off after them too,
   * so Friday's run covers through Monday.
   */
  through: number;
  /** The cut-offs between, in order, `next` first. */
  cutoffs: number[];
  /** True when it covers more than the next cut-off. */
  rollover: boolean;
  /** The cut-off before `next` (what has been debited already). */
  previous: number;
}

export function coverage(t: number, s: CutoffSchedule): Coverage {
  const next = nextCutoff(t, s);
  const previous = previousCutoff(t, s);
  const nextDate = localDate(next, s.timeZone);
  const dayAfter = addDays(nextDate, 1);
  const following = businessDayOnOrAfter(dayAfter, s);
  if (following === dayAfter) return { next, through: next, cutoffs: [next], rollover: false, previous };
  const through = cutoffOn(following, s);
  return { next, through, cutoffs: [next, through], rollover: true, previous };
}

/** The forced run: early enough for the off-ramp (and a margin) to land before the cut-off. */
export function forcedRunAt(cutoff: number, latencyMinutes: number, marginMinutes: number): number {
  return cutoff - (latencyMinutes + marginMinutes) * 60;
}

/** The end of the business day `n` business days after the one `t` falls on (or the next one). */
export function businessDaysAfter(t: number, n: number, s: CutoffSchedule): number {
  const d = addBusinessDays(localDate(t, s.timeZone), n, s);
  return zonedInstant(addDays(d, 1), 0, s.timeZone) - 1;
}

/** Parses SETTLEMENT_CUTOFF_TIME ("14:00"); null when it does not. */
export function parseClock(raw: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

