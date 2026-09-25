import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { businessDate } from '../orders/orderService.js';
import { addDays, endBreak, endShift, mondayOf, personHours, saveStaffHours, ShiftError, shiftsNow, staffWeek, startBreak, startShift, weekday } from './shiftService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const TZ = 'America/Los_Angeles';
const WEEKDAYS = { days: [0, 1, 2, 3, 4].map((day) => ({ day, open: { from: '08:00', to: '16:00' } })) };

describe('dates', () => {
  test('Monday first, and the Monday of any day', () => {
    expect(weekday('2026-09-21')).toBe(0);
    expect(weekday('2026-09-27')).toBe(6);
    expect(mondayOf('2026-09-27')).toBe('2026-09-21');
    expect(mondayOf('2026-09-21')).toBe('2026-09-21');
    expect(addDays('2026-09-28', -1)).toBe('2026-09-27');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('shifts', () => {
  test('a PIN starts a shift once; handing over starts another; End shift ends only its own', async () => {
    const { merchant, staff } = await seedShop(db);
    await startShift(db, { merchant, staffId: staff.jen });
    await startShift(db, { merchant, staffId: staff.jen });
    await startShift(db, { merchant, staffId: staff.manager });
    const on = await shiftsNow(db, merchant);
    expect(on.map((s) => s.name)).toEqual(['Jen', 'Ana']);
    expect(on[0]).toMatchObject({ role: 'counter', onBreakSince: null, breakMinutes: 0, booked: null });

    await endShift(db, { merchant, staffId: staff.jen, by: staff.jen });
    expect((await shiftsNow(db, merchant)).map((s) => s.name)).toEqual(['Ana']);
    // Ending a shift that isn't running does nothing.
    await endShift(db, { merchant, staffId: staff.jen, by: staff.jen });
    // And a new PIN starts a new one.
    await startShift(db, { merchant, staffId: staff.jen });
    expect(await shiftsNow(db, merchant)).toHaveLength(2);
  });

  test('breaks: one at a time, only on shift, and they add up', async () => {
    const { merchant, staff } = await seedShop(db);
    await expect(startBreak(db, { merchant, staffId: staff.jen })).rejects.toThrow(ShiftError);
    await startShift(db, { merchant, staffId: staff.jen });
    await expect(endBreak(db, { merchant, staffId: staff.jen })).rejects.toThrow('You are not on a break');

    const on = await startBreak(db, { merchant, staffId: staff.jen });
    expect(on.onBreakSince).not.toBeNull();
    await expect(startBreak(db, { merchant, staffId: staff.jen })).rejects.toThrow('You are already on a break');
    // A 20-minute break, as if it began earlier.
    await db.query(`UPDATE merchant.shift_breaks SET started_at = now() - interval '20 minutes' WHERE ended_at IS NULL`);
    const back = await endBreak(db, { merchant, staffId: staff.jen });
    expect(back.onBreakSince).toBeNull();
    expect(back.breakMinutes).toBe(20);

    // Ending the shift mid-break ends the break too.
    await startBreak(db, { merchant, staffId: staff.jen });
    await endShift(db, { merchant, staffId: staff.jen, by: staff.manager });
    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM merchant.shift_breaks WHERE ended_at IS NULL');
    expect(rows[0]!.n).toBe(0);
  });

  test('a shift left open from an earlier day is closed eight hours in, and says so', async () => {
    const { merchant, staff } = await seedShop(db);
    await startShift(db, { merchant, staffId: staff.luis });
    await db.query(`UPDATE merchant.shifts SET started_at = now() - interval '2 days' WHERE staff_id = $1`, [staff.luis]);
    expect(await shiftsNow(db, merchant)).toEqual([]);
    const { rows } = await db.query<{ auto_ended: boolean; hours: number }>(
      `SELECT auto_ended, extract(epoch FROM ended_at - started_at) / 3600 AS hours FROM merchant.shifts WHERE staff_id = $1`,
      [staff.luis],
    );
    expect(rows[0]).toMatchObject({ auto_ended: true });
    expect(Number(rows[0]!.hours)).toBe(8);
    // Their next PIN starts a fresh shift.
    await startShift(db, { merchant, staffId: staff.luis });
    expect(await shiftsNow(db, merchant)).toHaveLength(1);
  });

  test('someone removed is not on shift', async () => {
    const { merchant, staff } = await seedShop(db);
    await startShift(db, { merchant, staffId: staff.jen });
    await db.query('UPDATE merchant.staff SET active = false WHERE id = $1', [staff.jen]);
    expect(await shiftsNow(db, merchant)).toEqual([]);
  });
});

describe('hours', () => {
  test('someone with no hours gets them this week; after that, a change starts next Monday', async () => {
    const { merchant, staff } = await seedShop(db);
    const monday = mondayOf(businessDate(TZ));
    expect(await personHours(db, merchant, staff.jen)).toEqual({ usual: null, next: null, thisWeek: null, nextWeekOf: addDays(monday, 7) });

    const first = await saveStaffHours(db, { merchant, staffId: staff.jen, body: { hours: WEEKDAYS, once: false } });
    expect(first.usual).toEqual(WEEKDAYS);
    expect(first.next).toBeNull();
    // Still being set up this week: a second change replaces them.
    const fixed = { days: WEEKDAYS.days.slice(0, 4) };
    expect((await saveStaffHours(db, { merchant, staffId: staff.jen, body: { hours: fixed, once: false } })).usual).toEqual(fixed);

    // Usual hours from an earlier week: this week stays, the change waits for Monday.
    await db.query('UPDATE merchant.staff_hours SET week_of = $2 WHERE staff_id = $1', [staff.jen, addDays(monday, -14)]);
    const later = await saveStaffHours(db, { merchant, staffId: staff.jen, body: { hours: WEEKDAYS, once: false } });
    expect(later.usual).toEqual(fixed);
    expect(later.next).toEqual(WEEKDAYS);
  });

  test('this week only, over the usual hours, and the week shows it', async () => {
    const { merchant, staff } = await seedShop(db);
    await db.query(`INSERT INTO merchant.shop_hours (merchant, weekday, opens, closes) VALUES ($1, 0, '08:00', '18:00'), ($1, 5, '09:00', '14:00')`, [merchant]);
    await saveStaffHours(db, { merchant, staffId: staff.jen, body: { hours: WEEKDAYS, once: false } });
    const off = { days: WEEKDAYS.days.filter((d) => d.day !== 3) };
    const h = await saveStaffHours(db, { merchant, staffId: staff.jen, body: { hours: off, once: true } });
    expect(h.thisWeek).toEqual(off);
    expect(h.usual).toEqual(WEEKDAYS);

    const week = await staffWeek(db, merchant);
    expect(week.weekOf).toBe(mondayOf(businessDate(TZ)));
    expect(week.days.map((d) => d.open)).toEqual([{ from: '08:00', to: '18:00' }, null, null, null, null, { from: '09:00', to: '14:00' }, null]);
    expect(week.booked[staff.jen]![3]).toBeNull();
    expect(week.booked[staff.jen]![0]).toEqual({ from: '08:00', to: '16:00' });
    expect(week.usual[staff.jen]).toEqual(WEEKDAYS);
    expect(week.booked[staff.luis]).toBeUndefined();
    expect(week.lastShift[staff.jen]).toBeNull();

    // Next week: the usual hours again.
    const next = await staffWeek(db, merchant, addDays(week.weekOf, 8));
    expect(next.booked[staff.jen]![3]).toEqual({ from: '08:00', to: '16:00' });
  });

  test('a date the shop is closed shows in its week', async () => {
    const { merchant } = await seedShop(db);
    const monday = mondayOf(businessDate(TZ));
    await db.query(`INSERT INTO merchant.shop_hours (merchant, weekday, opens, closes) VALUES ($1, 2, '08:00', '18:00')`, [merchant]);
    await db.query(`INSERT INTO merchant.shop_closures (merchant, on_date, label) VALUES ($1, $2, 'Inventory day')`, [merchant, addDays(monday, 2)]);
    expect((await staffWeek(db, merchant)).days[2]!.open).toBeNull();
  });

  test('refused: a day twice, closing before opening, someone not on the team', async () => {
    const { merchant, staff } = await seedShop(db);
    const twice = { days: [WEEKDAYS.days[0], WEEKDAYS.days[0]] };
    await expect(saveStaffHours(db, { merchant, staffId: staff.jen, body: { hours: twice, once: false } })).rejects.toThrow('Each day once');
    const backwards = { days: [{ day: 0, open: { from: '16:00', to: '08:00' } }] };
    await expect(saveStaffHours(db, { merchant, staffId: staff.jen, body: { hours: backwards, once: false } })).rejects.toThrow('It closes after it opens');
    const other = await seedShop(db);
    await expect(saveStaffHours(db, { merchant, staffId: other.staff.jen, body: { hours: WEEKDAYS, once: false } })).rejects.toThrow('That person is not on the team');
  });

  test('on shift now carries today’s booking', async () => {
    const { merchant, staff } = await seedShop(db);
    const all = { days: Array.from({ length: 7 }, (_, day) => ({ day, open: { from: '07:00', to: '15:00' } })) };
    await saveStaffHours(db, { merchant, staffId: staff.jen, body: { hours: all, once: false } });
    await startShift(db, { merchant, staffId: staff.jen });
    expect((await shiftsNow(db, merchant))[0]!.booked).toEqual({ from: '07:00', to: '15:00' });
    expect((await staffWeek(db, merchant)).lastShift[staff.jen]).not.toBeNull();
  });
});
