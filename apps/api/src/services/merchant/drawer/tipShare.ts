import type { Queryable } from '../../../db/db.js';
import { businessDate } from '../orders/orderService.js';

/**
 * Who a day's tips belong to (Settings › Tips › Who gets them).
 *
 *   raiser  each tip to whoever raised the charge (or the person it was given to).
 *   hours   the day's tips pooled and shared by time on shift that day: each shift that started on
 *           the business day, from PIN to End shift (or now, for someone still on), less breaks.
 *           Card and cash are shared apart, since cash tips come out of the drawer and card tips
 *           are paid with payroll. Cents are shared by largest remainder, so the shares add up.
 *
 * The same answer for the close (which books it: closeService.ts) and for Overview before then.
 * A day nobody clocked in for is shared by raiser, and says so.
 */

export type TipHow = 'card' | 'cash';
export interface TipShare {
  staffId: string;
  cents: number;
  how: TipHow;
}
export interface DayTips {
  /** Each person's tips, card and cash apart. */
  byStaff: TipShare[];
  /** What each raised: the ledger's tips accounts before any sharing. */
  raised: TipShare[];
  /** Set when shared by hours: each person's minutes on shift. */
  hours: Array<{ staffId: string; minutes: number }> | null;
}

/** The tips raised on a business day, by person and how they were paid. Clear tips are paid like card tips. */
export async function raisedTips(q: Queryable, merchant: string, date: string): Promise<TipShare[]> {
  const { rows } = await q.query<{ staff_id: string; how: TipHow; cents: string | number }>(
    `SELECT COALESCE(t.tip_staff_id, t.created_by) AS staff_id, CASE WHEN t.method = 'cash' THEN 'cash' ELSE 'card' END AS how, sum(t.tip_cents) AS cents
       FROM payments.tenders t JOIN commerce.orders o ON o.id = t.order_id
      WHERE o.merchant = $1 AND o.business_date = $2 AND t.tip_cents > 0
        AND t.status IN ('authorised','approved','captured','partly_refunded','refunded')
      GROUP BY 1, 2 ORDER BY 1, 2`,
    [merchant, date],
  );
  return rows.map((r) => ({ staffId: r.staff_id, how: r.how, cents: Number(r.cents) }));
}

/** Minutes each person was on shift on a business day, less breaks; a shift or break still open counts to `until`. */
export async function minutesOnShift(q: Queryable, merchant: string, date: string, until: Date = new Date()): Promise<Map<string, number>> {
  const { rows: tz } = await q.query<{ timezone: string }>('SELECT timezone FROM merchant.profiles WHERE merchant = $1', [merchant]);
  const zone = tz[0]?.timezone ?? 'UTC';
  // A window wide enough for any timezone; the business day is checked below.
  const { rows } = await q.query<{ id: string; staff_id: string; started_at: Date | string; ended_at: Date | string | null }>(
    `SELECT id, staff_id, started_at, ended_at FROM merchant.shifts
      WHERE merchant = $1 AND started_at >= ($2::date - 1) AND started_at < ($2::date + 2) ORDER BY started_at`,
    [merchant, date],
  );
  const shifts = rows.filter((s) => businessDate(zone, new Date(s.started_at)) === date);
  const out = new Map<string, number>();
  if (!shifts.length) return out;
  const { rows: breaks } = await q.query<{ shift_id: string; started_at: Date | string; ended_at: Date | string | null }>(
    'SELECT shift_id, started_at, ended_at FROM merchant.shift_breaks WHERE shift_id = ANY($1::text[])',
    [shifts.map((s) => s.id)],
  );
  const span = (from: Date | string, to: Date | string | null) => Math.max(0, Math.min(to ? new Date(to).getTime() : until.getTime(), until.getTime()) - new Date(from).getTime());
  for (const s of shifts) {
    const onMs = span(s.started_at, s.ended_at) - breaks.filter((b) => b.shift_id === s.id).reduce((sum, b) => sum + span(b.started_at, b.ended_at), 0);
    out.set(s.staff_id, (out.get(s.staff_id) ?? 0) + Math.max(0, Math.floor(onMs / 60_000)));
  }
  for (const [k, v] of out) if (v === 0) out.delete(k);
  return out;
}

/** `cents` shared by `minutes`: whole cents, largest remainder first (ties to more minutes, then by id). */
export function shareByMinutes(cents: number, minutes: Map<string, number>): Map<string, number> {
  const total = [...minutes.values()].reduce((s, m) => s + m, 0);
  const out = new Map<string, number>();
  if (cents <= 0 || total <= 0) return out;
  const parts = [...minutes].map(([id, m]) => ({ id, m, exact: (cents * m) / total }));
  for (const p of parts) out.set(p.id, Math.floor(p.exact));
  let left = cents - [...out.values()].reduce((s, c) => s + c, 0);
  const order = [...parts].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || b.m - a.m || (a.id < b.id ? -1 : 1));
  for (const p of order) {
    if (left <= 0) break;
    out.set(p.id, out.get(p.id)! + 1);
    left--;
  }
  return out;
}

export async function dayTips(q: Queryable, input: { merchant: string; date: string; goTo: 'raiser' | 'hours'; until?: Date }): Promise<DayTips> {
  const raised = await raisedTips(q, input.merchant, input.date);
  if (input.goTo !== 'hours' || !raised.length) return { byStaff: raised, raised, hours: null };
  const minutes = await minutesOnShift(q, input.merchant, input.date, input.until);
  if (!minutes.size) return { byStaff: raised, raised, hours: null };
  const byStaff: TipShare[] = [];
  for (const how of ['card', 'cash'] as const) {
    const pool = raised.filter((r) => r.how === how).reduce((s, r) => s + r.cents, 0);
    for (const [staffId, cents] of shareByMinutes(pool, minutes)) if (cents > 0) byStaff.push({ staffId, cents, how });
  }
  return { byStaff, raised, hours: [...minutes].map(([staffId, m]) => ({ staffId, minutes: m })).sort((a, b) => b.minutes - a.minutes) };
}
