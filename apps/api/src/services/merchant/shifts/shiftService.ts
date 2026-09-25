import { randomUUID } from 'node:crypto';
import { type PersonHours, SaveStaffHours, type ShiftNow, type StaffHours, type StaffWeek } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { businessDate } from '../orders/orderService.js';

/**
 * Shifts, breaks and staff hours (merchant UI: Staff and Home).
 *
 * A shift starts when someone's PIN goes in (POST /session) and ends when they sign out with End
 * shift, or when an owner or manager ends it for them. Handing the tablet to someone else ends
 * nothing: everyone who started a shift is on until they end it. At most one open shift a person,
 * and one open break a shift, both held by unique indexes.
 *
 * A shift nobody ended is closed on the next read after its day, eight hours in (or now, if
 * sooner), and marked auto_ended. That is a guess, and the record says it is one.
 *
 * Hours are plans by week (migration 0013): a person's usual hours from a Monday on, and a week
 * that differs. Days are Monday first, in the shop's timezone, like the shop's own hours.
 */

export class ShiftError extends Error {
  constructor(
    message: string,
    readonly code: 'not_on_shift' | 'on_break' | 'not_on_break' | 'not_found' | 'invalid',
  ) {
    super(message);
    this.name = 'ShiftError';
  }
}

const STALE_HOURS = 8;

// ---- Dates ---------------------------------------------------------------------------------------

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const fromDate = (d: Date) => d.toISOString().slice(0, 10);
/** Monday first: 0 is Monday, 6 Sunday. */
export const weekday = (date: string) => (toDate(date).getUTCDay() + 6) % 7;
export const addDays = (date: string, n: number) => fromDate(new Date(toDate(date).getTime() + n * 86400_000));
export const mondayOf = (date: string) => addDays(date, -weekday(date));
const iso = (v: Date | string) => new Date(v).toISOString();
const dateText = (v: Date | string) => (typeof v === 'string' ? v.slice(0, 10) : fromDate(v));
const hhmm = (t: string) => t.slice(0, 5);

async function timezone(q: Queryable, merchant: string): Promise<string> {
  const { rows } = await q.query<{ timezone: string }>('SELECT timezone FROM merchant.profiles WHERE merchant = $1', [merchant]);
  if (!rows[0]) throw new ShiftError('That shop does not exist', 'not_found');
  return rows[0].timezone;
}

// ---- Plans ---------------------------------------------------------------------------------------

const asHours = (days: unknown): StaffHours => ({ days: [...(days as StaffHours['days'])].sort((a, b) => a.day - b.day) });

/** Each person's plan for the week of `monday`: this week only if there is one, else their usual. */
async function plans(q: Queryable, merchant: string, monday: string, usualOnly = false): Promise<Map<string, StaffHours>> {
  const { rows } = await q.query<{ staff_id: string; days: unknown }>(
    `SELECT DISTINCT ON (staff_id) staff_id, days FROM merchant.staff_hours
      WHERE merchant = $1 AND ((NOT once AND week_of <= $2) ${usualOnly ? '' : 'OR (once AND week_of = $2)'})
      ORDER BY staff_id, once DESC, week_of DESC`,
    [merchant, monday],
  );
  return new Map(rows.map((r) => [r.staff_id, asHours(r.days)]));
}

const spanOn = (h: StaffHours | undefined, day: number) => h?.days.find((d) => d.day === day)?.open ?? null;

// ---- Shifts --------------------------------------------------------------------------------------

/** Close shifts left open from an earlier day. */
async function sweep(q: Queryable, merchant: string, tz: string): Promise<void> {
  const today = businessDate(tz);
  const { rows } = await q.query<{ id: string; started_at: Date | string }>(
    'SELECT id, started_at FROM merchant.shifts WHERE merchant = $1 AND ended_at IS NULL',
    [merchant],
  );
  for (const r of rows) {
    if (businessDate(tz, new Date(r.started_at)) >= today) continue;
    const end = new Date(Math.min(Date.now(), new Date(r.started_at).getTime() + STALE_HOURS * 3600_000)).toISOString();
    await q.query('UPDATE merchant.shift_breaks SET ended_at = GREATEST(started_at, $2::timestamptz) WHERE shift_id = $1 AND ended_at IS NULL', [r.id, end]);
    await q.query(`UPDATE merchant.shifts SET ended_at = $2, ended_by = 'auto', auto_ended = true WHERE id = $1`, [r.id, end]);
  }
}

/** Someone's PIN went in: their shift starts, unless one is already running. */
export async function startShift(q: Queryable, input: { merchant: string; staffId: string; deviceId?: string | null }): Promise<void> {
  const tz = await timezone(q, input.merchant);
  await sweep(q, input.merchant, tz);
  await q.query(
    `INSERT INTO merchant.shifts (id, merchant, staff_id, device_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (staff_id) WHERE ended_at IS NULL DO NOTHING`,
    [`shf_${randomUUID()}`, input.merchant, input.staffId, input.deviceId ?? null],
  );
}

/** End someone's shift, and any break they are on. Ending a shift that isn't running does nothing. */
export async function endShift(db: Db, input: { merchant: string; staffId: string; by: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      'SELECT id FROM merchant.shifts WHERE merchant = $1 AND staff_id = $2 AND ended_at IS NULL FOR UPDATE',
      [input.merchant, input.staffId],
    );
    if (!rows[0]) return;
    await tx.query('UPDATE merchant.shift_breaks SET ended_at = now() WHERE shift_id = $1 AND ended_at IS NULL', [rows[0].id]);
    await tx.query('UPDATE merchant.shifts SET ended_at = now(), ended_by = $2 WHERE id = $1', [rows[0].id, input.by]);
  });
}

/** Everyone on shift now, the earliest first. */
export async function shiftsNow(q: Queryable, merchant: string): Promise<ShiftNow[]> {
  const tz = await timezone(q, merchant);
  await sweep(q, merchant, tz);
  const today = businessDate(tz);
  const plan = await plans(q, merchant, mondayOf(today));
  const { rows } = await q.query<{
    id: string;
    staff_id: string;
    name: string;
    role: ShiftNow['role'];
    started_at: Date | string;
    on_break: Date | string | null;
    break_minutes: string | number;
  }>(
    `SELECT s.id, s.staff_id, st.name, st.role, s.started_at,
            (SELECT b.started_at FROM merchant.shift_breaks b WHERE b.shift_id = s.id AND b.ended_at IS NULL) AS on_break,
            COALESCE((SELECT floor(sum(extract(epoch FROM b.ended_at - b.started_at)) / 60) FROM merchant.shift_breaks b
                       WHERE b.shift_id = s.id AND b.ended_at IS NOT NULL), 0) AS break_minutes
       FROM merchant.shifts s JOIN merchant.staff st ON st.id = s.staff_id
      WHERE s.merchant = $1 AND s.ended_at IS NULL AND st.active
      ORDER BY s.started_at`,
    [merchant],
  );
  return rows.map((r) => ({
    staffId: r.staff_id,
    name: r.name,
    role: r.role,
    startedAt: iso(r.started_at),
    onBreakSince: r.on_break ? iso(r.on_break) : null,
    breakMinutes: Number(r.break_minutes),
    booked: spanOn(plan.get(r.staff_id), weekday(today)),
  }));
}

async function mine(q: Queryable, merchant: string, staffId: string): Promise<ShiftNow> {
  const me = (await shiftsNow(q, merchant)).find((s) => s.staffId === staffId);
  if (!me) throw new ShiftError('You are not on shift', 'not_on_shift');
  return me;
}

export async function startBreak(db: Db, input: { merchant: string; staffId: string }): Promise<ShiftNow> {
  const now = await mine(db, input.merchant, input.staffId);
  if (now.onBreakSince) throw new ShiftError('You are already on a break', 'on_break');
  await db.query(
    `INSERT INTO merchant.shift_breaks (id, shift_id)
     SELECT $1, id FROM merchant.shifts WHERE merchant = $2 AND staff_id = $3 AND ended_at IS NULL
     ON CONFLICT (shift_id) WHERE ended_at IS NULL DO NOTHING`,
    [`brk_${randomUUID()}`, input.merchant, input.staffId],
  );
  return mine(db, input.merchant, input.staffId);
}

export async function endBreak(db: Db, input: { merchant: string; staffId: string }): Promise<ShiftNow> {
  const now = await mine(db, input.merchant, input.staffId);
  if (!now.onBreakSince) throw new ShiftError('You are not on a break', 'not_on_break');
  await db.query(
    `UPDATE merchant.shift_breaks SET ended_at = now()
      WHERE ended_at IS NULL AND shift_id IN (SELECT id FROM merchant.shifts WHERE merchant = $1 AND staff_id = $2 AND ended_at IS NULL)`,
    [input.merchant, input.staffId],
  );
  return mine(db, input.merchant, input.staffId);
}

// ---- The week ------------------------------------------------------------------------------------

export async function staffWeek(q: Queryable, merchant: string, date?: string): Promise<StaffWeek> {
  const tz = await timezone(q, merchant);
  const today = businessDate(tz);
  const monday = mondayOf(date ?? today);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const { rows: week } = await q.query<{ weekday: number; opens: string; closes: string }>(
    'SELECT weekday, opens::text, closes::text FROM merchant.shop_hours WHERE merchant = $1',
    [merchant],
  );
  const { rows: closures } = await q.query<{ on_date: Date | string; opens: string | null; closes: string | null }>(
    'SELECT on_date, opens::text, closes::text FROM merchant.shop_closures WHERE merchant = $1 AND on_date BETWEEN $2 AND $3',
    [merchant, dates[0], dates[6]],
  );
  const days = dates.map((d, i) => {
    const c = closures.find((x) => dateText(x.on_date) === d);
    if (c) return { date: d, open: c.opens && c.closes ? { from: hhmm(c.opens), to: hhmm(c.closes) } : null };
    const w = week.find((x) => x.weekday === i);
    return { date: d, open: w ? { from: hhmm(w.opens), to: hhmm(w.closes) } : null };
  });

  const { rows: staff } = await q.query<{ id: string }>('SELECT id FROM merchant.staff WHERE merchant = $1 AND active', [merchant]);
  const plan = await plans(q, merchant, monday);
  const usual = await plans(q, merchant, monday, true);
  const { rows: last } = await q.query<{ staff_id: string; at: Date | string }>(
    'SELECT staff_id, max(started_at) AS at FROM merchant.shifts WHERE merchant = $1 GROUP BY staff_id',
    [merchant],
  );

  return {
    weekOf: monday,
    today,
    days,
    booked: Object.fromEntries(staff.filter((s) => plan.has(s.id)).map((s) => [s.id, dates.map((_, i) => spanOn(plan.get(s.id), i))])),
    usual: Object.fromEntries(staff.map((s) => [s.id, usual.get(s.id) ?? null])),
    lastShift: Object.fromEntries(staff.map((s) => [s.id, (() => { const r = last.find((x) => x.staff_id === s.id); return r ? iso(r.at) : null; })()])),
  };
}

// ---- A person's hours ----------------------------------------------------------------------------

async function member(q: Queryable, merchant: string, staffId: string) {
  const { rows } = await q.query<{ id: string; role: string; active: boolean }>('SELECT id, role, active FROM merchant.staff WHERE id = $1 AND merchant = $2', [staffId, merchant]);
  if (!rows[0] || !rows[0].active) throw new ShiftError('That person is not on the team', 'not_found');
  return rows[0];
}

export async function personHours(q: Queryable, merchant: string, staffId: string): Promise<PersonHours> {
  await member(q, merchant, staffId);
  const monday = mondayOf(businessDate(await timezone(q, merchant)));
  const next = addDays(monday, 7);
  const { rows } = await q.query<{ week_of: Date | string; once: boolean; days: unknown }>(
    'SELECT week_of, once, days FROM merchant.staff_hours WHERE staff_id = $1 AND merchant = $2 ORDER BY week_of DESC',
    [staffId, merchant],
  );
  const at = (r: (typeof rows)[number]) => dateText(r.week_of);
  const usual = rows.find((r) => !r.once && at(r) <= monday);
  const upcoming = rows.find((r) => !r.once && at(r) > monday);
  const once = rows.find((r) => r.once && at(r) === monday);
  return {
    usual: usual ? asHours(usual.days) : null,
    next: upcoming ? asHours(upcoming.days) : null,
    thisWeek: once ? asHours(once.days) : null,
    nextWeekOf: next,
  };
}

/**
 * "This week only" replaces this week. "Every week" changes the usual hours from next Monday, as
 * the sheet says, so a week already under way stays as booked. Someone with no usual hours yet,
 * or whose usual hours only began this week, gets them from this week: there is nothing to keep.
 */
export async function saveStaffHours(db: Db, input: { merchant: string; staffId: string; body: unknown }): Promise<PersonHours> {
  const parsed = SaveStaffHours.safeParse(input.body);
  if (!parsed.success) throw new ShiftError(parsed.error.issues[0]?.message ?? 'Those hours do not work', 'invalid');
  await member(db, input.merchant, input.staffId);
  const monday = mondayOf(businessDate(await timezone(db, input.merchant)));
  const before = await personHours(db, input.merchant, input.staffId);
  // Usual hours that only began this Monday are still being set up: a change replaces them.
  const { rows: fresh } = await db.query('SELECT 1 FROM merchant.staff_hours WHERE staff_id = $1 AND NOT once AND week_of = $2', [input.staffId, monday]);
  const weekOf = parsed.data.once || !before.usual || fresh.length ? monday : addDays(monday, 7);
  await db.transaction(async (tx) => {
    if (!parsed.data.once) {
      await tx.query('DELETE FROM merchant.staff_hours WHERE staff_id = $1 AND NOT once AND week_of > $2', [input.staffId, weekOf]);
    }
    await tx.query(
      `INSERT INTO merchant.staff_hours (staff_id, merchant, week_of, once, days) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (staff_id, week_of, once) DO UPDATE SET days = EXCLUDED.days, updated_at = now()`,
      [input.staffId, input.merchant, weekOf, parsed.data.once, JSON.stringify(asHours(parsed.data.hours.days).days)],
    );
  });
  return personHours(db, input.merchant, input.staffId);
}
