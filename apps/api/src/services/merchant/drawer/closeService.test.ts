import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { createCardTender, syncCardTender } from '../cards/cardTenders.js';
import { connectorStore } from '../cards/connectorStore.js';
import { fakeProvider } from '../cards/fakeProvider.js';
import { tipsPayable } from '../ledger/accounts.js';
import { balance } from '../ledger/ledgerService.js';
import { createOrder, type OrderDeps } from '../orders/orderService.js';
import { createCashTender } from '../orders/payments.js';
import { updateSettings } from '../shop/shopService.js';
import * as close from './closeService.js';
import { daySummaryText } from './daySummary.js';
import { openDrawer } from './drawerService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

let seq = 0;
const key = () => `close-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const deps: OrderDeps = { taxApi: null, pinCheck: async () => null };

/** A day at the counter: $150 float, $61.79 of cash sales ($5.00 of it Jen's tip). */
async function day(opts: { twoCounts?: boolean } = {}) {
  const s = await seedShop(db);
  if (opts.twoCounts === false) await updateSettings(db, { merchant: s.merchant, staffId: s.staff.owner, patch: { twoCounts: false } });
  const drawer = await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
  const sell = async (amountCents: number, tipCents = 0) => {
    const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'Patch', note: null, amountCents, taxKind: 'labour' }] });
    await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents, tipCents, handedOverCents: amountCents + tipCents, idempotencyKey: key() } });
    return o;
  };
  await sell(3679, 500);
  await sell(2000);
  const pins: Record<string, { id: string; role: 'manager' | 'owner' | 'counter' }> = {
    '1111': { id: s.staff.manager, role: 'manager' },
    '9999': { id: s.staff.owner, role: 'owner' },
    '4821': { id: s.staff.jen, role: 'counter' },
  };
  const pinCheck: OrderDeps['pinCheck'] = async (_m, p) => pins[p] ?? null;
  const count = (staffId: string, totalCents: number) => close.saveCount(db, { merchant: s.merchant, sessionId: drawer.id, staffId, count: { method: 'total', totalCents } });
  return { ...s, drawer, sell, pinCheck, count };
}

describe('blind counts', () => {
  test('each counter sees only their own count until both are in; the second is someone else', async () => {
    const d = await day();
    expect(await balance(db, d.merchant, 'drawer_cash')).toBe(21179);
    const jen = await d.count(d.staff.jen, 20800);
    expect(jen).toMatchObject({ state: 'awaiting_second', mine: { totalCents: 20800 } });
    expect(JSON.stringify(jen)).not.toContain('21179');
    expect(await close.counts(db, { merchant: d.merchant, sessionId: d.drawer.id, viewer: d.staff.luis })).toEqual({ state: 'awaiting_second', mine: null });
    await expect(d.count(d.staff.jen, 20800)).rejects.toMatchObject({ code: 'someone_else' });
    const both = await d.count(d.staff.luis, 20800);
    expect(both).toMatchObject({ state: 'compared', expectedCents: 21179, differenceCents: -379, countsAgree: true, signoffNeeded: true });
    await expect(d.count(d.staff.manager, 20800)).rejects.toMatchObject({ code: 'both_counted' });
  });

  test('counts that disagree show each other and never the expected; one of the two counts again', async () => {
    const d = await day();
    await d.count(d.staff.jen, 20800);
    const v = await d.count(d.staff.luis, 21000);
    expect(v.state).toBe('disagree');
    expect(JSON.stringify(v)).not.toContain('21179');
    await expect(close.recount(db, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen, which: 'second' })).rejects.toMatchObject({ code: 'someone_else' });
    await close.recount(db, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.luis, which: 'second' });
    const again = await d.count(d.staff.luis, 20800);
    expect(again).toMatchObject({ state: 'compared', countsAgree: true, differenceCents: -379 });
    // The first try is kept, set aside.
    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM payments.drawer_counts WHERE session_id = $1 AND superseded_at IS NOT NULL', [d.drawer.id]);
    expect(rows[0]!.n).toBe(1);
  });

  test('with two counts off, one count is compared at once', async () => {
    const d = await day({ twoCounts: false });
    expect(await d.count(d.staff.jen, 21179)).toMatchObject({ state: 'compared', differenceCents: 0, signoffNeeded: false });
    await expect(d.count(d.staff.luis, 21179)).rejects.toMatchObject({ code: 'both_counted' });
  });

  test('counting stops cash going in: the drawer is being counted', async () => {
    const d = await day();
    await d.count(d.staff.jen, 21179);
    await expect(d.sell(1000)).rejects.toMatchObject({ code: 'drawer_closed' });
  });
});

describe('a difference, signed off', () => {
  test('by a manager or owner who wasn’t the first counter, with a note; then nothing more is needed', async () => {
    const d = await day();
    await d.count(d.staff.manager, 20800);
    await d.count(d.staff.luis, 20800);
    const sign = (pin: string) => close.signOff(db, { pinCheck: d.pinCheck }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.luis, signOff: { note: 'Short a few coins', pin } });
    await expect(sign('4821')).rejects.toMatchObject({ code: 'signer_invalid' });
    await expect(sign('1111')).rejects.toMatchObject({ code: 'signer_invalid', message: 'Someone other than the first counter signs it off' });
    expect(await sign('9999')).toMatchObject({ state: 'compared', signoffNeeded: false, differenceCents: -379 });
  });
});

describe('Close the day', () => {
  test('the reference evening: $3.79 short, signed off; cash tips paid out, $150 left, the rest to the bank, and a locked report', async () => {
    const d = await day();
    await d.count(d.staff.jen, 20800);
    await d.count(d.staff.luis, 20800);
    await expect(close.closeDay(db, { card: null }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen })).rejects.toMatchObject({ code: 'unsigned' });
    await close.signOff(db, { pinCheck: d.pinCheck }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen, signOff: { note: 'Short a few coins', pin: '9999' } });

    const { report } = await close.closeDay(db, { card: null }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen });
    expect(report.drawer).toEqual({ startingCashCents: 15000, expectedCents: 21179, countedCents: 20800, differenceCents: -379, leaveCents: 15000, toBankCents: 20800 - 500 - 15000, signedOffBy: d.staff.owner });
    expect(report).toMatchObject({ takenCents: 6179, byMethod: { cash: { count: 2, cents: 6179 }, card: { count: 0, cents: 0 } }, tipsCents: 500, tipsByStaff: [{ staffId: d.staff.jen, cents: 500, how: 'cash' }] });
    // The books: the drawer holds exactly tomorrow's float; the rest is on its way to the bank.
    expect(await balance(db, d.merchant, 'drawer_cash')).toBe(15000);
    expect(await balance(db, d.merchant, 'cash_in_transit_to_bank')).toBe(5300);
    expect(await balance(db, d.merchant, 'cash_over_short')).toBe(379);
    expect(await balance(db, d.merchant, tipsPayable(d.staff.jen))).toBe(0);
    // Closing again returns the same report; the report can't be edited.
    expect((await close.closeDay(db, { card: null }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen })).report.id).toBe(report.id);
    await expect(db.query(`UPDATE payments.day_reports SET report = '{}' WHERE id = $1`, [report.id])).rejects.toThrow('immutable');
    expect(await close.dayReports(db, { merchant: d.merchant, from: '1970-01-01', to: '9999-12-31' })).toHaveLength(1);

    // Mark deposited: in transit becomes in the bank, once.
    const [dep] = await close.bankDeposits(db, d.merchant);
    expect(dep).toMatchObject({ amountCents: 5300, markedAt: null });
    await close.markDeposited(db, { merchant: d.merchant, depositId: dep!.id, staffId: d.staff.owner });
    await close.markDeposited(db, { merchant: d.merchant, depositId: dep!.id, staffId: d.staff.owner });
    expect(await balance(db, d.merchant, 'cash_in_transit_to_bank')).toBe(0);
    expect(await balance(db, d.merchant, 'bank')).toBe(5300 - 15000);
  });

  test('captures the day’s cards, keeps card tips owed for payroll, and blocks while an order is half-paid', async () => {
    const d = await day();
    const fake = fakeProvider();
    const acct = `acct_close_${d.merchant.slice(-6)}`;
    const cc = await connectorStore.insert(db, { merchant: d.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: d.staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    const reader = `rdr_close_${d.merchant.slice(-6)}`;
    await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1,$2,$3,'stripe','m2',$4,'M2')`, [reader, d.merchant, cc.id, `M2-${reader}`]);
    const o = await createOrder(db, deps, { merchant: d.merchant, staffId: d.staff.jen, lines: [{ itemId: null, name: 'Tires', note: null, amountCents: 40000, taxKind: 'goods' }] });
    const start = await createCardTender(db, fake.provider, { merchant: d.merchant, orderId: o.id, staffId: d.staff.jen, amountCents: 40000, tipCents: 1000, readerId: reader, idempotencyKey: key() });
    fake.tap([...fake.payments.keys()][0]!);
    await syncCardTender(db, fake.provider, { merchant: d.merchant, tenderId: start.tenderId, actor: null });

    // A half-paid order holds the close.
    const half = await createOrder(db, deps, { merchant: d.merchant, staffId: d.staff.jen, lines: [{ itemId: null, name: 'Rotation', note: null, amountCents: 5000, taxKind: 'labour' }] });
    await createCashTender(db, { merchant: d.merchant, orderId: half.id, staffId: d.staff.jen, tender: { amountCents: 2000, tipCents: 0, handedOverCents: 2000, idempotencyKey: key() } });
    await d.count(d.staff.jen, 23179);
    await d.count(d.staff.luis, 23179);
    await expect(close.closeDay(db, { card: fake.provider }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen })).rejects.toMatchObject({ code: 'orders_open' });
  });

  test('with nothing half-paid: the card is captured and its tip stays owed', async () => {
    const d = await day();
    const fake = fakeProvider();
    const acct = `acct_close2_${d.merchant.slice(-6)}`;
    const cc = await connectorStore.insert(db, { merchant: d.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: d.staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    const reader = `rdr_close2_${d.merchant.slice(-6)}`;
    await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1,$2,$3,'stripe','m2',$4,'M2')`, [reader, d.merchant, cc.id, `M2-${reader}`]);
    const o = await createOrder(db, deps, { merchant: d.merchant, staffId: d.staff.jen, lines: [{ itemId: null, name: 'Tires', note: null, amountCents: 40000, taxKind: 'goods' }] });
    const start = await createCardTender(db, fake.provider, { merchant: d.merchant, orderId: o.id, staffId: d.staff.jen, amountCents: 40000, tipCents: 1000, readerId: reader, idempotencyKey: key() });
    const pi = [...fake.payments.keys()][0]!;
    fake.tap(pi);
    await syncCardTender(db, fake.provider, { merchant: d.merchant, tenderId: start.tenderId, actor: null });
    await d.count(d.staff.jen, 21179);
    await d.count(d.staff.luis, 21179);
    const { report } = await close.closeDay(db, { card: fake.provider }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen });
    expect(fake.payments.get(pi)!.state).toBe('captured');
    expect(report.byMethod.card).toEqual({ count: 1, cents: 41000 });
    expect(report.tipsByStaff).toEqual(expect.arrayContaining([{ staffId: d.staff.jen, cents: 1000, how: 'card' }, { staffId: d.staff.jen, cents: 500, how: 'cash' }]));
    // Cash tips paid from the drawer; the card tip is still owed, for payroll.
    expect(await close.tipsOwed(db, d.merchant, d.staff.jen)).toBe(1000);
    expect(report.drawer).toMatchObject({ differenceCents: 0, signedOffBy: null, leaveCents: 15000, toBankCents: 21179 - 500 - 15000 });
  });

  test('can’t close without both counts, or while they disagree', async () => {
    const d = await day();
    await expect(close.closeDay(db, { card: null }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen })).rejects.toMatchObject({ code: 'counts_needed' });
    await d.count(d.staff.jen, 20000);
    await d.count(d.staff.luis, 21179);
    await expect(close.closeDay(db, { card: null }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen })).rejects.toMatchObject({ code: 'counts_disagree' });
  });
});

describe('the end-of-day summary', () => {
  const closeWith = async (settings: { endOfDay: boolean; email: string | null } | null, mail = { configured: () => true, sent: [] as Array<{ to: string; subject: string; body: string }> }) => {
    const d = await day({ twoCounts: false });
    if (settings) await updateSettings(db, { merchant: d.merchant, staffId: d.staff.owner, patch: { notifications: settings } });
    await d.count(d.staff.jen, 21179);
    const r = await close.closeDay(db, { card: null, mail: { configured: mail.configured, send: async (e) => void mail.sent.push(e) } }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen });
    return { d, r, sent: mail.sent };
  };

  test('emailed when the day is closed, to the shop’s address', async () => {
    const { d, sent } = await closeWith({ endOfDay: true, email: 'marcus@shop.example' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('marcus@shop.example');
    expect(sent[0]!.subject).toMatch(/^Shop \d+: \$61\.79 taken /);
    expect(sent[0]!.body).toContain('Closed by Jen');
    expect(sent[0]!.body).toContain('Difference         none');
    expect(sent[0]!.body).toContain('Jen  $5.00');
    // Closing again (the same report) doesn't send it twice.
    await close.closeDay(db, { card: null, mail: { configured: () => true, send: async (e) => void sent.push(e) } }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen });
    expect(sent).toHaveLength(1);
  });

  test('not sent: switched off, no address, email not set up; a failed send never stops the close', async () => {
    expect((await closeWith({ endOfDay: false, email: 'marcus@shop.example' })).sent).toHaveLength(0);
    expect((await closeWith(null)).sent).toHaveLength(0);
    expect((await closeWith({ endOfDay: true, email: 'marcus@shop.example' }, { configured: () => false, sent: [] })).sent).toHaveLength(0);
    const d = await day({ twoCounts: false });
    await updateSettings(db, { merchant: d.merchant, staffId: d.staff.owner, patch: { notifications: { endOfDay: true, email: 'marcus@shop.example' } } });
    await d.count(d.staff.jen, 21179);
    const r = await close.closeDay(db, { card: null, mail: { configured: () => true, send: async () => { throw new Error('Resend refused the email (500)'); } } }, { merchant: d.merchant, sessionId: d.drawer.id, staffId: d.staff.jen });
    expect(r.report.takenCents).toBe(6179);
  });

  test('the text: a short day, a difference signed off, a card that couldn’t be captured', () => {
    const t = daySummaryText(
      {
        id: 'r',
        shop: 's',
        businessDate: '2026-09-22',
        takenCents: 125000,
        byMethod: { clear: { count: 2, cents: 100000 }, card: { count: 1, cents: 20000 }, cash: { count: 1, cents: 5000 } },
        tipsCents: 1500,
        tipsByStaff: [{ staffId: 'j', cents: 1000, how: 'card' }, { staffId: 'j', cents: 500, how: 'cash' }],
        taxCents: 1600,
        discountsCents: 0,
        refundsCents: 0,
        drawer: { startingCashCents: 15000, expectedCents: 20000, countedCents: 19500, differenceCents: -500, leaveCents: 15000, toBankCents: 4000, signedOffBy: 'm' },
        closedBy: 'l',
        closedAt: '2026-09-23T01:02:00.000Z',
      },
      { shop: 'Mike’s Tire', nameOf: (id) => ({ j: 'Jen R.', m: 'Mike R.', l: 'Luis M.' })[id] ?? '?', captureFailures: 1 },
    );
    expect(t.subject).toBe('Mike’s Tire: $1,250.00 taken Tuesday, September 22');
    expect(t.body).toContain('Difference         -$5.00, signed off by Mike R.');
    expect(t.body).toContain('Jen R.  $15.00');
    expect(t.body).toContain('1 card payment couldn’t be captured.');
  });
});

