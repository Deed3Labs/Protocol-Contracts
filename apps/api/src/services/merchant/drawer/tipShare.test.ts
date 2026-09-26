import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { tipsPayable } from '../ledger/accounts.js';
import { balance } from '../ledger/ledgerService.js';
import { createOrder, type OrderDeps } from '../orders/orderService.js';
import { createCashTender } from '../orders/payments.js';
import { updateSettings } from '../shop/shopService.js';
import * as close from './closeService.js';
import { daySummaryText } from './daySummary.js';
import { openDrawer } from './drawerService.js';
import { overview } from '../overview.js';
import { dayTips, minutesOnShift, shareByMinutes } from './tipShare.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

let seq = 0;
const key = () => `tips-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const deps: OrderDeps = { taxApi: null, pinCheck: async () => null };
const MIN = 60_000;

/** A zone where it's about noon now, so shifts a few hours back are the same business day whenever this runs. */
function noonZone(): string {
  const offset = 12 - new Date().getUTCHours();
  return offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
}

/**
 * A day: Jen raised a $6.00 cash tip; Luis raised none. Jen was on 3 hours with a 30 minute
 * break, Luis 1 hour 30.
 */
async function day(goTo: 'raiser' | 'hours') {
  const s = await seedShop(db);
  await db.query('UPDATE merchant.profiles SET timezone = $2 WHERE merchant = $1', [s.merchant, noonZone()]);
  await updateSettings(db, { merchant: s.merchant, staffId: s.staff.owner, patch: { tips: { enabled: true, mode: 'amounts', presets: [500], goTo } } });
  const drawer = await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
  const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'Patch', note: null, amountCents: 2000, taxKind: 'labour' }] });
  await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 2000, tipCents: 600, handedOverCents: 2600, idempotencyKey: key() } });

  const now = Date.now();
  const at = (minsAgo: number) => new Date(now - minsAgo * MIN).toISOString();
  await db.query(`INSERT INTO merchant.shifts (id, merchant, staff_id, started_at, ended_at) VALUES ($1,$2,$3,$4,$5), ($6,$2,$7,$8,$9)`, [
    `sh_${key()}`,
    s.merchant,
    s.staff.jen,
    at(200),
    at(20),
    `sh_${key()}`,
    s.staff.luis,
    at(110),
    at(20),
  ]);
  const { rows } = await db.query<{ id: string }>('SELECT id FROM merchant.shifts WHERE staff_id = $1', [s.staff.jen]);
  await db.query('INSERT INTO merchant.shift_breaks (id, shift_id, started_at, ended_at) VALUES ($1,$2,$3,$4)', [`br_${key()}`, rows[0]!.id, at(120), at(90)]);
  return { ...s, drawer, now: new Date(now) };
}

describe('sharing cents by minutes', () => {
  test('whole cents that add up, largest remainder first', () => {
    const three = shareByMinutes(100, new Map([['a', 1], ['b', 1], ['c', 1]]));
    expect([...three.values()].reduce((s, c) => s + c, 0)).toBe(100);
    expect([...three.values()].sort()).toEqual([33, 33, 34]);
    expect(Object.fromEntries(shareByMinutes(1500, new Map([['jen', 150], ['luis', 90]])))).toEqual({ jen: 938, luis: 562 });
    expect(shareByMinutes(0, new Map([['a', 5]])).size).toBe(0);
    expect(shareByMinutes(500, new Map()).size).toBe(0);
    // A tie on the remainder goes to more minutes, then by id: the same answer every time.
    expect(Object.fromEntries(shareByMinutes(1, new Map([['b', 10], ['a', 10]])))).toEqual({ a: 1, b: 0 });
  });
});

describe('splitting tips by hours on shift', () => {
  test('minutes on shift, less breaks, for the business day', async () => {
    const d = await day('hours');
    const today = (await db.query<{ business_date: string }>('SELECT business_date::text FROM commerce.orders WHERE merchant = $1', [d.merchant])).rows[0]!.business_date;
    expect(Object.fromEntries(await minutesOnShift(db, d.merchant, today, d.now))).toEqual({ [d.staff.jen]: 150, [d.staff.luis]: 90 });
  });

  test('before the close, Overview’s answer: the pool shared 150 : 90', async () => {
    const d = await day('hours');
    const today = (await db.query<{ business_date: string }>('SELECT business_date::text FROM commerce.orders WHERE merchant = $1', [d.merchant])).rows[0]!.business_date;
    const t = await dayTips(db, { merchant: d.merchant, date: today, goTo: 'hours', until: d.now });
    expect(t.byStaff).toEqual([
      { staffId: d.staff.jen, cents: 375, how: 'cash' },
      { staffId: d.staff.luis, cents: 225, how: 'cash' },
    ]);
    expect(t.hours).toEqual([
      { staffId: d.staff.jen, minutes: 150 },
      { staffId: d.staff.luis, minutes: 90 },
    ]);
    const raiser = await dayTips(db, { merchant: d.merchant, date: today, goTo: 'raiser', until: d.now });
    expect(raiser).toEqual({ byStaff: [{ staffId: d.staff.jen, cents: 600, how: 'cash' }], raised: raiser.raised, hours: null });
  });

  test('the close books it: each person’s share paid out of the drawer, and the report says by hours', async () => {
    const d = await day('hours');
    await updateSettings(db, { merchant: d.merchant, staffId: d.staff.owner, patch: { twoCounts: false } });
    const expected = await balance(db, d.merchant, 'drawer_cash');
    await close.saveCount(db, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen, count: { method: 'total', totalCents: expected } });
    const { report } = await close.closeDay(db, { card: null }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen });
    expect(report.tipsCents).toBe(600);
    expect(report.tipsByStaff).toEqual([
      { staffId: d.staff.jen, cents: 375, how: 'cash' },
      { staffId: d.staff.luis, cents: 225, how: 'cash' },
    ]);
    expect(report.tipsHours).toEqual([
      { staffId: d.staff.jen, minutes: 150 },
      { staffId: d.staff.luis, minutes: 90 },
    ]);
    const names: Record<string, string> = { [d.staff.jen]: 'Jen', [d.staff.luis]: 'Luis' };
    const { body } = daySummaryText(report, { shop: 'Shop', nameOf: (id) => names[id] ?? id, captureFailures: 0 });
    expect(body).toContain('TIPS BY PERSON, SHARED BY HOURS ON SHIFT');
    expect(body).toContain('Jen  $3.75 (2h 30m)');
    expect(body).toContain('Luis  $2.25 (1h 30m)');
    // Both paid out of the drawer at close: nobody is owed anything, and the drawer holds the float.
    expect(await balance(db, d.merchant, tipsPayable(d.staff.jen))).toBe(0);
    expect(await balance(db, d.merchant, tipsPayable(d.staff.luis))).toBe(0);
    expect(await balance(db, d.merchant, 'drawer_cash')).toBe(report.drawer.leaveCents);
  });

  test('nobody clocked in: by raiser, and the report says so', async () => {
    const d = await day('hours');
    await db.query('DELETE FROM merchant.shifts WHERE merchant = $1', [d.merchant]);
    await updateSettings(db, { merchant: d.merchant, staffId: d.staff.owner, patch: { twoCounts: false } });
    const expected = await balance(db, d.merchant, 'drawer_cash');
    await close.saveCount(db, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen, count: { method: 'total', totalCents: expected } });
    const { report } = await close.closeDay(db, { card: null }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen });
    expect(report.tipsByStaff).toEqual([{ staffId: d.staff.jen, cents: 600, how: 'cash' }]);
    expect(report.tipsHours ?? null).toBeNull();
  });

  test('Overview shows the split before the close, and the report’s after', async () => {
    const d = await day('hours');
    const range = { merchant: d.merchant, from: '1970-01-01', to: '9999-12-31' };
    const before = await overview(db, range);
    expect(before.tips.cents).toBe(600);
    expect(before.tips.byStaff).toEqual([
      { staffId: d.staff.jen, name: 'Jen', cents: 375, cashCents: 375 },
      { staffId: d.staff.luis, name: 'Luis', cents: 225, cashCents: 225 },
    ]);
    await updateSettings(db, { merchant: d.merchant, staffId: d.staff.owner, patch: { twoCounts: false } });
    await close.saveCount(db, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen, count: { method: 'total', totalCents: await balance(db, d.merchant, 'drawer_cash') } });
    await close.closeDay(db, { card: null }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen });
    // Luis working on after the close doesn't change what was paid.
    await db.query(`UPDATE merchant.shifts SET ended_at = now() + interval '5 hours' WHERE staff_id = $1`, [d.staff.luis]);
    expect((await overview(db, range)).tips.byStaff.map((t) => t.cents)).toEqual([375, 225]);

    // By raiser, Overview is as it was.
    const r = await day('raiser');
    expect((await overview(db, { ...range, merchant: r.merchant })).tips.byStaff).toEqual([{ staffId: r.staff.jen, name: 'Jen', cents: 600, cashCents: 600 }]);
  });
});
