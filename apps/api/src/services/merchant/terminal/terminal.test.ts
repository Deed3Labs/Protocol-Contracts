import { beforeAll, describe, expect, test } from 'bun:test';
import type Stripe from 'stripe';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { chargeContentsFrom } from '../../chargeContents.js';
import { createItem, updateItem, saveCategoryOrder } from '../catalog/catalogService.js';
import { connectorStore } from '../cards/connectorStore.js';
import { fakeProvider } from '../cards/fakeProvider.js';
import { openDrawer } from '../drawer/drawerService.js';
import { createOrder, getOrder, updateOrder, type OrderDeps } from '../orders/orderService.js';
import { type ClearCharges, createCashTender } from '../orders/payments.js';
import { buildReceipt, ensureReceiptCode, receiptByCode } from '../orders/receipts.js';
import { cardPaymentHandlers } from '../stripeEvents/cardPaymentHandlers.js';
import { getSettings, updateSettings } from '../shop/shopService.js';
import { approveNoSale, drawerDay, saveDrawerEvents } from './drawerLog.js';
import * as floor from './floor.js';
import { activatePoint, addDevice, claimPoint, drawerKey, listHardware, pointByKey, removeDevice, updateDevice } from './hardware.js';
import { menuFor, pointStateFor, publicPoint, screenFor, showOnPoint } from './pointState.js';
import { publicJoinWaitlist, publicPay } from './publicPages.js';
import type { Texter } from './texts.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const deps: OrderDeps = { taxApi: null, pinCheck: async () => null };
let seq = 0;
const key = () => `t-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const later = (from: Date, seconds: number) => new Date(from.getTime() + seconds * 1000);
const CODES = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let codeSeq = 1000;
/** A Point fresh off the line: a code nobody has used. */
async function madePoint(): Promise<string> {
  let n = ++codeSeq;
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code = CODES[n % 32] + code;
    n = Math.floor(n / 32);
  }
  await db.query('INSERT INTO merchant.point_keys (code) VALUES ($1)', [code]);
  return code;
}

function texts() {
  const sent: Array<{ to: string; message: string }> = [];
  const notices: Array<Parameters<NonNullable<Texter['notifyMember']>>[0]> = [];
  const texter: Texter = { send: async (m) => (sent.push(m), true), notifyMember: async (n) => (notices.push(n), true) };
  return { sent, notices, texter };
}

/** Mi Casa Tacos at dinner: tables 1 and 6 seat two, 14 seats four; a Point at 6 and 14, one at the door and one at the counter. */
async function tacos() {
  const s = await seedShop(db);
  await floor.saveTables(db, {
    merchant: s.merchant,
    staffId: s.staff.owner,
    tables: [
      { number: 1, label: null, area: null, seats: 2 },
      { number: 6, label: null, area: 'by the window', seats: 2 },
      { number: 14, label: null, area: null, seats: 4 },
    ],
  });
  const f = await floor.floor(db, s.merchant);
  const table = (n: number) => f.tables.find((t) => t.number === n)!.id;
  const point = async (placement: 'table' | 'door' | 'counter', tableId: string | null = null) => {
    const code = await madePoint();
    const claimed = await claimPoint(db, { merchant: s.merchant, staffId: s.staff.owner, request: { code }, apiBase: 'https://api.example' });
    await updateDevice(db, { merchant: s.merchant, staffId: s.staff.owner, id: claimed.device.id, patch: { name: tableId ? 'Table' : placement, point: { placement, tableId } } });
    const { deviceKey } = await activatePoint(db, { code, secret: claimed.provisioning.secret });
    return { id: claimed.device.id, code, deviceKey };
  };
  const at6 = await point('table', table(6));
  const at14 = await point('table', table(14));
  const door = await point('door');
  const counter = await point('counter');
  const pastor = await createItem(db, { merchant: s.merchant, staffId: s.staff.owner, item: { name: 'Al pastor', detail: null, category: 'Tacos', priceCents: 450, taxKind: 'food', stockTracked: false, reorderAt: null, costCents: null } });
  const horchata = await createItem(db, { merchant: s.merchant, staffId: s.staff.owner, item: { name: 'Horchata', detail: null, category: 'Drinks', priceCents: 350, taxKind: 'food', stockTracked: false, reorderAt: null, costCents: null } });
  return { ...s, table, at6, at14, door, counter, pastor, horchata };
}

async function waiting(t: Awaited<ReturnType<typeof tacos>>, name: string, size: number, phone: string | null = null) {
  return floor.addParty(db, { merchant: t.merchant, staffId: t.staff.manager, party: { name, size, phone, textConsent: Boolean(phone) } });
}

const tab = (t: Awaited<ReturnType<typeof tacos>>, tableId: string, now?: Date) =>
  createOrder(db, deps, { merchant: t.merchant, staffId: t.staff.jen, lines: [{ itemId: t.pastor.id, quantity: 4, optionIds: [] }], request: { tableId }, now });

describe('claiming and activating a Point', () => {
  test('a code claims once; the secret works once; the key then names the Point', async () => {
    const s = await seedShop(db);
    const other = await seedShop(db);
    const code = await madePoint();
    const claimed = await claimPoint(db, { merchant: s.merchant, staffId: s.staff.owner, request: { code: code.toLowerCase() }, apiBase: 'https://api.example' });
    expect(claimed.device).toMatchObject({ kind: 'point', code, settings: { placement: 'table', idleMode: 'number', suggestBeforePaying: false } });
    await expect(claimPoint(db, { merchant: other.merchant, staffId: other.staff.owner, request: { code }, apiBase: 'x' })).rejects.toMatchObject({ code: 'taken' });
    await expect(activatePoint(db, { code, secret: 'x'.repeat(43) })).rejects.toMatchObject({ code: 'forbidden' });
    const { deviceKey } = await activatePoint(db, { code, secret: claimed.provisioning.secret });
    await expect(activatePoint(db, { code, secret: claimed.provisioning.secret })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await pointByKey(db, deviceKey)).toMatchObject({ code, merchant: s.merchant });
    await removeDevice(db, { merchant: s.merchant, staffId: s.staff.owner, id: claimed.device.id });
    expect(await pointByKey(db, deviceKey)).toBeNull();
    // Unpaired, it can be claimed again.
    expect((await claimPoint(db, { merchant: other.merchant, staffId: other.staff.owner, request: { code }, apiBase: 'x' })).device.code).toBe(code);
  });

  test('a setup secret lapses after ten minutes', async () => {
    const s = await seedShop(db);
    const code = await madePoint();
    const claimed = await claimPoint(db, { merchant: s.merchant, staffId: s.staff.owner, request: { code }, apiBase: 'x' });
    await expect(activatePoint(db, { code, secret: claimed.provisioning.secret, now: later(new Date(), 11 * 60) })).rejects.toMatchObject({ code: 'expired' });
  });

  test('moving a Point starts it on that place’s idle screen; a reader links to one Point', async () => {
    const t = await tacos();
    const door = (await listHardware(db, t.merchant)).find((d) => d.id === t.door.id)!;
    expect(door.kind === 'point' && door.settings.idleMode).toBe('waitlist');
    const counter = (await listHardware(db, t.merchant)).find((d) => d.id === t.counter.id)!;
    expect(counter.kind === 'point' && counter.settings.idleMode).toBe('pay');
    await db.query(`INSERT INTO merchant.card_connectors (id, merchant, provider, external_account_id) VALUES ($1, $2, 'stripe', $3)`, [`con_${t.merchant}`, t.merchant, `acct_${t.merchant}`]).catch(() => undefined);
    await db.query(`INSERT INTO merchant.readers (id, merchant, provider, type, external_reader_id, label) VALUES ($1, $2, 'stripe', 'm2', 'M2-1A3F', 'M2 1A3F')`, [`rdr_${t.merchant}`, t.merchant]);
    await updateDevice(db, { merchant: t.merchant, staffId: t.staff.owner, id: t.at6.id, patch: { point: { readerId: `rdr_${t.merchant}` } } });
    await expect(updateDevice(db, { merchant: t.merchant, staffId: t.staff.owner, id: t.at14.id, patch: { point: { readerId: `rdr_${t.merchant}` } } })).rejects.toMatchObject({ code: 'taken' });
  });
});

describe('what a Point shows, from one place', () => {
  test('idle → bill → paid → idle', async () => {
    const t = await tacos();
    await openDrawer(db, { merchant: t.merchant, staffId: t.staff.jen });
    const now = new Date();
    expect((await pointStateFor(db, t.at14.id, now)).state).toEqual({ kind: 'idle', mode: 'number' });
    const order = await tab(t, t.table(14));
    await showOnPoint(db, { merchant: t.merchant, staffId: t.staff.jen, pointId: t.at14.id, request: { kind: 'order', orderId: order.id }, now });
    expect((await pointStateFor(db, t.at14.id, now)).state).toMatchObject({ kind: 'bill', orderId: order.id });
    expect((await publicPoint(db, t.at14.code, now)).view).toBe('bill');
    await createCashTender(db, { merchant: t.merchant, orderId: order.id, staffId: t.staff.jen, tender: { amountCents: order.totalCents, tipCents: 0, handedOverCents: order.totalCents, idempotencyKey: key() } });
    expect((await pointStateFor(db, t.at14.id)).state).toMatchObject({ kind: 'paid', orderId: order.id });
    const paidPage = await publicPoint(db, t.at14.code);
    expect(paidPage.paid?.receipt.totalCents).toBe(order.totalCents);
    // "Email me this receipt" goes by the receipt's code, so the paid page makes it, once.
    expect(paidPage.paid?.receipt.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect((await publicPoint(db, t.at14.code)).paid?.receipt.code).toBe(paidPage.paid?.receipt.code);
    expect((await pointStateFor(db, t.at14.id, later(new Date(), 181))).state).toEqual({ kind: 'idle', mode: 'number' });
  });

  test('an alert covers a bill, and the bill comes back when it lapses', async () => {
    const t = await tacos();
    const now = new Date();
    const order = await createOrder(db, deps, { merchant: t.merchant, staffId: t.staff.jen, lines: [{ itemId: t.horchata.id, quantity: 1, optionIds: [] }] });
    await showOnPoint(db, { merchant: t.merchant, staffId: t.staff.jen, pointId: t.counter.id, request: { kind: 'order', orderId: order.id }, now });
    const party = await waiting(t, 'Lee', 4);
    await floor.createAlert(db, texts().texter, { merchant: t.merchant, staffId: t.staff.jen, request: { kind: 'table_ready', partyId: party.id, pointId: t.counter.id }, now });
    expect((await pointStateFor(db, t.counter.id, now)).state.kind).toBe('alert');
    expect((await pointStateFor(db, t.counter.id, later(now, 601))).state).toMatchObject({ kind: 'bill', orderId: order.id });
  });
});

describe('seating a party (the seating addendum)', () => {
  test('Seat holds the table and its Point, Table ready goes to the door, and the text says where', async () => {
    const t = await tacos();
    const { sent, notices, texter } = texts();
    const ana = await waiting(t, 'Ana Ruiz', 2, '(909) 555-0142');
    const now = new Date();
    const seated = await floor.seatParty(db, texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: ana.id, request: { tableId: t.table(6), showName: true, text: true }, now });
    expect(seated.party.state).toBe('seated');
    expect(seated.table).toMatchObject({ status: 'held', hold: { partyName: 'Ana', showName: true } });
    const screen = (await screenFor(db, t.at6.id, now)).screen;
    expect(screen.state).toMatchObject({ kind: 'held', partyName: 'Ana', partySize: 2 });
    expect(screen.lit).toBe(true);
    expect((await pointStateFor(db, t.door.id, now)).state.kind).toBe('alert');
    expect(sent).toEqual([{ to: '+19095550142', message: 'Your table is ready: 6, by the window' }]);
    // And in the Clear app, if the number is a member's (section 13).
    expect(notices).toEqual([{ phone: '+19095550142', wallet: null, title: 'Your table is ready', body: expect.stringMatching(/ · Table 6, by the window$/), dedupeKey: expect.stringMatching(/^table_ready:alr_/) }]);
    // The same seat again changes nothing, and texts nobody twice.
    await floor.seatParty(db, texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: ana.id, request: { tableId: t.table(6), showName: true, text: true }, now });
    expect(sent).toHaveLength(1);
    expect(notices).toHaveLength(1);
  });

  test('the name is off: Reserved; and the phone page never shows a name', async () => {
    const t = await tacos();
    const ana = await waiting(t, 'Ana', 2);
    const quiet = texts();
    await floor.seatParty(db, quiet.texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: ana.id, request: { tableId: t.table(6), showName: false, text: false } });
    // No text, so no notice either: the app's is the text's twin, never more.
    expect(quiet.notices).toEqual([]);
    expect((await pointStateFor(db, t.at6.id)).state).toMatchObject({ kind: 'held', partyName: null });
    const lee = await waiting(t, 'Lee', 4);
    await floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: lee.id, request: { tableId: t.table(14), showName: true, text: false } });
    const page = await publicPoint(db, t.at14.code);
    expect(page.view).toBe('menu');
    expect(JSON.stringify(page)).not.toContain('Lee');
    expect(page).not.toHaveProperty('state');
  });

  test('held → idle on the first item, on staff seating them, and after 15 minutes', async () => {
    const t = await tacos();
    const seat = async (tableId: string, name: string) => {
      const p = await waiting(t, name, 2);
      await floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: p.id, request: { tableId, showName: true, text: false } });
    };
    await seat(t.table(6), 'Ana');
    await tab(t, t.table(6));
    expect((await pointStateFor(db, t.at6.id)).state).toEqual({ kind: 'idle', mode: 'number' });
    expect((await floor.getTable(db, t.merchant, t.table(6))).status).toBe('ordering');

    await seat(t.table(14), 'Lee');
    await floor.seatTable(db, { merchant: t.merchant, staffId: t.staff.jen, tableId: t.table(14) });
    expect((await pointStateFor(db, t.at14.id)).state.kind).toBe('idle');
    expect((await floor.getTable(db, t.merchant, t.table(14))).status).toBe('seated');

    const u = await tacos();
    const p = await waiting(u, 'Marco', 2);
    const now = new Date();
    await floor.seatParty(db, texts().texter, { merchant: u.merchant, staffId: u.staff.manager, partyId: p.id, request: { tableId: u.table(6), showName: true, text: false }, now });
    expect((await pointStateFor(db, u.at6.id, later(now, 14 * 60))).state.kind).toBe('held');
    expect((await pointStateFor(db, u.at6.id, later(now, 15 * 60))).state.kind).toBe('idle');
    expect(await floor.sweepLapsed(db, later(now, 15 * 60))).toBeGreaterThan(0);
    expect((await floor.getTable(db, u.merchant, u.table(6), later(now, 15 * 60))).status).toBe('seated');
  });

  test('held → bill: a bill sent to a held table wins and clears the hold', async () => {
    const t = await tacos();
    const p = await waiting(t, 'Priya', 2);
    await floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: p.id, request: { tableId: t.table(6), showName: true, text: false } });
    const order = await createOrder(db, deps, { merchant: t.merchant, staffId: t.staff.jen, lines: [{ itemId: t.horchata.id, quantity: 2, optionIds: [] }] });
    await showOnPoint(db, { merchant: t.merchant, staffId: t.staff.jen, pointId: t.at6.id, request: { kind: 'order', orderId: order.id } });
    expect((await pointStateFor(db, t.at6.id)).state.kind).toBe('bill');
    const { rows } = await db.query<{ hold_party_id: string | null }>('SELECT hold_party_id FROM merchant.tables WHERE id = $1', [t.table(6)]);
    expect(rows[0]!.hold_party_id).toBeNull();
  });

  test('a held table that is freed is seated again for the next party', async () => {
    const t = await tacos();
    await openDrawer(db, { merchant: t.merchant, staffId: t.staff.jen });
    const ana = await waiting(t, 'Ana', 2);
    await floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: ana.id, request: { tableId: t.table(6), showName: true, text: false } });
    const order = await tab(t, t.table(6));
    await createCashTender(db, { merchant: t.merchant, orderId: order.id, staffId: t.staff.jen, tender: { amountCents: order.totalCents, tipCents: 0, handedOverCents: order.totalCents, idempotencyKey: key() } });
    expect((await floor.getTable(db, t.merchant, t.table(6))).status).toBe('paid');
    await floor.clearTable(db, { merchant: t.merchant, staffId: t.staff.jen, tableId: t.table(6) });
    const lee = await waiting(t, 'Lee', 2);
    const again = await floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: lee.id, request: { tableId: t.table(6), showName: true, text: false } });
    expect(again.table).toMatchObject({ status: 'held', hold: { partyName: 'Lee' } });
    expect((await pointStateFor(db, t.at6.id)).state).toMatchObject({ kind: 'held', partyName: 'Lee' });
  });

  test('a table that isn’t free can’t be seated, and a text needs a number', async () => {
    const t = await tacos();
    const a = await waiting(t, 'Ana', 2);
    const b = await waiting(t, 'Lee', 2);
    await floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: a.id, request: { tableId: t.table(6), showName: true, text: false } });
    await expect(floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: b.id, request: { tableId: t.table(6), showName: true, text: false } })).rejects.toMatchObject({ code: 'conflict' });
    await expect(floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: b.id, request: { tableId: t.table(1), showName: true, text: true } })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('Call and Bill (the Pay case addendum)', () => {
  const press = (t: Awaited<ReturnType<typeof tacos>>, point: { id: string; code: string }, button: 'call' | 'bill', at: Date, now = at) =>
    floor.pointButton(db, { point: { deviceId: point.id, merchant: t.merchant, code: point.code }, event: { kind: 'button', button, at: at.toISOString() }, now });

  test('call → answered, and the Point goes back to what it showed (idle, held, bill)', async () => {
    const t = await tacos();
    const now = new Date();
    const call = (await press(t, t.at14, 'call', now))!;
    expect(call).toMatchObject({ kind: 'call', state: 'open' });
    expect((await pointStateFor(db, t.at14.id, now)).state.kind).toBe('called');
    expect((await floor.getTable(db, t.merchant, t.table(14), now)).request?.id).toBe(call.id);
    await floor.answerTableRequest(db, { merchant: t.merchant, staffId: t.staff.luis, requestId: call.id });
    expect((await pointStateFor(db, t.at14.id, now)).state).toEqual({ kind: 'idle', mode: 'number' });

    const p = await waiting(t, 'Ana', 2);
    await floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: p.id, request: { tableId: t.table(6), showName: true, text: false }, now });
    const onHeld = (await press(t, t.at6, 'call', now))!;
    await floor.answerTableRequest(db, { merchant: t.merchant, staffId: t.staff.luis, requestId: onHeld.id });
    expect((await pointStateFor(db, t.at6.id, now)).state.kind).toBe('held');

    const order = await tab(t, t.table(14));
    await showOnPoint(db, { merchant: t.merchant, staffId: t.staff.jen, pointId: t.at14.id, request: { kind: 'order', orderId: order.id }, now });
    const onBill = (await press(t, t.at14, 'call', now))!;
    expect((await pointStateFor(db, t.at14.id, now)).state.kind).toBe('called');
    await floor.answerTableRequest(db, { merchant: t.merchant, staffId: t.staff.luis, requestId: onBill.id });
    expect((await pointStateFor(db, t.at14.id, now)).state.kind).toBe('bill');
  });

  test('a second press is the same call; a later one cancels; it lapses after 10 minutes', async () => {
    const t = await tacos();
    const now = new Date();
    const first = (await press(t, t.at14, 'call', now))!;
    expect((await press(t, t.at14, 'call', later(now, 1)))!.id).toBe(first.id);
    expect((await floor.tableRequests(db, t.merchant, now)).filter((r) => r.state === 'open')).toHaveLength(1);
    expect(await press(t, t.at14, 'call', later(now, 5))).toMatchObject({ id: first.id, state: 'answered' });
    const again = (await press(t, t.at14, 'call', later(now, 10)))!;
    expect(again.id).not.toBe(first.id);
    expect((await pointStateFor(db, t.at14.id, later(now, 10 + 600))).state.kind).toBe('idle');
  });

  test('Bill with a tab sends the bill; without one it tells staff', async () => {
    const t = await tacos();
    const now = new Date();
    const order = await tab(t, t.table(14), now);
    const sent = (await press(t, t.at14, 'bill', now))!;
    expect(sent).toMatchObject({ kind: 'bill', state: 'bill_sent', billCents: order.totalCents });
    expect((await pointStateFor(db, t.at14.id, now)).state).toMatchObject({ kind: 'bill', orderId: order.id });
    const asked = (await press(t, t.at6, 'bill', now))!;
    expect(asked).toMatchObject({ kind: 'bill', state: 'open' });
    expect((await pointStateFor(db, t.at6.id, now)).state.kind).toBe('bill_asked');
  });

  test('a press older than two minutes is dropped', async () => {
    const t = await tacos();
    const now = new Date();
    expect(await press(t, t.at14, 'call', later(now, -121), now)).toBeNull();
  });
});

describe('the drawer log', () => {
  async function drawerShop() {
    const s = await seedShop(db);
    const session = await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    const drawer = await addDevice(db, {
      merchant: s.merchant,
      staffId: s.staff.owner,
      device: { kind: 'drawer', name: 'Clear Drawer 4F2A', settings: { bluetoothId: 'C1:EA:4F:2A', pairedTabletId: null, cabledToPrinter: false, printerId: null } },
    });
    const pins: Record<string, { id: string; role: 'counter' | 'manager' | 'owner' }> = { '1111': { id: s.staff.manager, role: 'manager' }, '4821': { id: s.staff.jen, role: 'counter' } };
    return { ...s, session, drawer, pinCheck: async (_m: string, pin: string) => pins[pin] ?? null };
  }

  test('a batch synced twice is kept once', async () => {
    const d = await drawerShop();
    const at = new Date().toISOString();
    const events = [
      { kind: 'opened', clientId: `evt-${key()}`, drawerId: d.drawer.id, at, staffId: d.staff.jen, reason: 'sale', orderId: null, noSale: null, approvalId: null },
      { kind: 'shut', clientId: `evt-${key()}`, drawerId: d.drawer.id, at, staffId: d.staff.jen },
    ];
    expect(await saveDrawerEvents(db, { merchant: d.merchant, staffId: d.staff.jen, batch: { events } })).toEqual({ saved: 2, duplicates: 0 });
    expect(await saveDrawerEvents(db, { merchant: d.merchant, staffId: d.staff.jen, batch: { events } })).toEqual({ saved: 0, duplicates: 2 });
    const dev = (await listHardware(db, d.merchant)).find((x) => x.id === d.drawer.id)!;
    expect(dev.kind === 'drawer' && dev.status).toMatchObject({ open: false, opensToday: 1 });
  });

  test('a No sale needs a manager’s PIN, then its approval opens the drawer once', async () => {
    const d = await drawerShop();
    const jen = { id: d.staff.jen, role: 'counter' as const };
    await expect(approveNoSale(db, d.pinCheck, { merchant: d.merchant, staff: jen, request: { reason: 'counting', note: null, pin: '4821' } })).rejects.toMatchObject({ code: 'forbidden' });
    const ok = await approveNoSale(db, d.pinCheck, { merchant: d.merchant, staff: jen, request: { reason: 'change_for_note', note: 'a $50', pin: '1111' } });
    expect(ok.approvedBy).toBe(d.staff.manager);
    const open = (clientId: string) => ({
      kind: 'opened', clientId, drawerId: d.drawer.id, at: new Date().toISOString(), staffId: d.staff.jen, reason: 'no_sale', orderId: null, noSale: { reason: 'change_for_note', note: 'a $50' }, approvalId: ok.approvalId,
    });
    await saveDrawerEvents(db, { merchant: d.merchant, staffId: d.staff.jen, batch: { events: [open(`evt-${key()}`)] } });
    await expect(saveDrawerEvents(db, { merchant: d.merchant, staffId: d.staff.jen, batch: { events: [open(`evt-${key()}`)] } })).rejects.toMatchObject({ code: 'conflict' });
    const day = await drawerDay(db, { merchant: d.merchant, sessionId: d.session.id });
    expect(day).toMatchObject({ opens: 1, withSale: 0, noSales: [{ reason: 'change_for_note', note: 'a $50', approvedBy: d.staff.manager }] });
  });

  test('with everyone allowed, the counter’s own PIN does; with PINs off, none', async () => {
    const d = await drawerShop();
    await updateSettings(db, { merchant: d.merchant, staffId: d.staff.owner, patch: { drawerNoSaleRoles: 'anyone' } });
    const jen = { id: d.staff.jen, role: 'counter' as const };
    expect((await approveNoSale(db, d.pinCheck, { merchant: d.merchant, staff: jen, request: { reason: 'counting', note: null, pin: '4821' } })).approvedBy).toBeNull();
    await updateSettings(db, { merchant: d.merchant, staffId: d.staff.owner, patch: { noSaleNeedsPin: false } });
    expect(await approveNoSale(db, d.pinCheck, { merchant: d.merchant, staff: jen, request: { reason: 'counting', note: null, pin: null } })).toMatchObject({ approvedBy: null });
    expect(await getSettings(db, d.merchant)).toMatchObject({ drawerNoSaleRoles: 'anyone', noSaleNeedsPin: false, tableService: false });
  });

  test('the drawer’s key comes back for an enrolled tablet', async () => {
    const d = await drawerShop();
    const k = await drawerKey(db, { merchant: d.merchant, drawerId: d.drawer.id });
    expect(Buffer.from(k.key, 'base64')).toHaveLength(32);
  });
});

describe('a cash sale rung up offline', () => {
  test('keeps the tablet’s figures, joins the drawer open then, and a retry is the same order', async () => {
    const s = await seedShop(db);
    const session = await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    const at = new Date().toISOString();
    const request = { idempotencyKey: 'ord-offline-1', offline: { createdAt: at, subtotalCents: 4225, taxCents: 345, totalCents: 4570 } };
    const lines = [{ itemId: null, name: 'Burritos', note: null, amountCents: 4225, taxKind: 'food' }];
    const order = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines, request });
    expect(order).toMatchObject({ totalCents: 4570, taxCents: 345, offline: true });
    expect((await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines, request })).id).toBe(order.id);
    const tender = await createCashTender(db, { merchant: s.merchant, orderId: order.id, staffId: s.staff.jen, tender: { amountCents: 4570, tipCents: 0, handedOverCents: 5000, idempotencyKey: 'cash-offline-1', clientCreatedAt: at } });
    expect(tender.changeCents).toBe(430);
    const { rows } = await db.query<{ drawer_session_id: string }>('SELECT drawer_session_id FROM payments.tenders WHERE id = $1', [tender.id]);
    expect(rows[0]!.drawer_session_id).toBe(session.id);
    expect((await getOrder(db, s.merchant, order.id)).status).toBe('paid');
  });

  test('its figures must add up', async () => {
    const s = await seedShop(db);
    await expect(
      createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'X', note: null, amountCents: 100, taxKind: 'food' }], request: { offline: { createdAt: new Date().toISOString(), subtotalCents: 100, taxCents: 8, totalCents: 120 } } }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('the menu, receipts and the phone page', () => {
  test('Off the menu still sells, but phones and Points don’t show it; categories in the shop’s order', async () => {
    const t = await tacos();
    await updateItem(db, { merchant: t.merchant, itemId: t.horchata.id, patch: { onMenu: false } });
    expect((await menuFor(db, t.merchant)).categories.map((c) => c.name)).toEqual(['Tacos']);
    await updateItem(db, { merchant: t.merchant, itemId: t.horchata.id, patch: { onMenu: true } });
    expect((await menuFor(db, t.merchant)).categories.map((c) => c.name)).toEqual(['Drinks', 'Tacos']);
    await saveCategoryOrder(db, { merchant: t.merchant, order: { names: ['Tacos', 'Drinks'] } });
    expect((await menuFor(db, t.merchant)).categories.map((c) => c.name)).toEqual(['Tacos', 'Drinks']);
  });

  test('a receipt’s code is made once, is random, and finds the receipt with its table', async () => {
    const t = await tacos();
    await openDrawer(db, { merchant: t.merchant, staffId: t.staff.jen });
    const order = await tab(t, t.table(6));
    expect(await ensureReceiptCode(db, { merchant: t.merchant, orderId: order.id, staffId: t.staff.jen })).toBeNull();
    await createCashTender(db, { merchant: t.merchant, orderId: order.id, staffId: t.staff.jen, tender: { amountCents: order.totalCents, tipCents: 0, handedOverCents: order.totalCents, idempotencyKey: key() } });
    const code = (await ensureReceiptCode(db, { merchant: t.merchant, orderId: order.id, staffId: t.staff.jen }))!;
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(await ensureReceiptCode(db, { merchant: t.merchant, orderId: order.id, staffId: t.staff.jen })).toBe(code);
    expect(await receiptByCode(db, code.toLowerCase())).toMatchObject({ table: 'Table 6, by the window', code });
    expect((await buildReceipt(db, t.merchant, order.id)).code).toBe(code);
    await expect(receiptByCode(db, String(order.number).padStart(10, '0'))).rejects.toMatchObject({ code: 'not_found' });
  });

  test('a door Point takes names; a table Point doesn’t', async () => {
    const t = await tacos();
    expect((await publicPoint(db, t.door.code)).view).toBe('waitlist');
    expect(await publicJoinWaitlist(db, { code: t.door.code, request: { name: 'Priya', size: 2, phone: '(909) 555-0142', textConsent: true } })).toEqual({ position: 1, quotedMinutes: 5 });
    await expect(publicJoinWaitlist(db, { code: t.at6.code, request: { name: 'X', size: 1, phone: null, textConsent: false } })).rejects.toMatchObject({ code: 'conflict' });
  });

  test('paying with Clear raises the counter’s own Clear tender for what is left', async () => {
    const t = await tacos();
    const order = await tab(t, t.table(14));
    await showOnPoint(db, { merchant: t.merchant, staffId: t.staff.jen, pointId: t.at14.id, request: { kind: 'order', orderId: order.id } });
    let raised = 0;
    const clear: ClearCharges = {
      raise: async () => (raised++, { ok: true, code: 'K7Q2M9XH' }),
      status: async () => 'pending',
      cancel: async () => true,
      sendTo: async () => ({ ok: true, label: '' }),
    };
    const started = await publicPay(db, { clear, card: async () => null }, { code: t.at14.code, request: { method: 'clear', idempotencyKey: 'phone-pay-1' } });
    expect(started).toMatchObject({ method: 'clear', chargeCode: 'K7Q2M9XH' });
    expect(started.method === 'clear' && started.url).toEndWith('/c/K7Q2M9XH');
    // A second tap (or a member's scan) opens the Clear charge already waiting, not a new one.
    expect(await publicPay(db, { clear, card: async () => null }, { code: t.at14.code, request: { method: 'clear', idempotencyKey: 'phone-pay-9' } })).toMatchObject({ chargeCode: 'K7Q2M9XH' });
    expect(raised).toBe(1);
    // The member's pay sheet says which table it is.
    expect((await chargeContentsFrom(db, { code: 'K7Q2M9XH', raisedBy: null, amountCents: order.totalCents })).table).toBe('Table 14');
    await expect(publicPay(db, { clear, card: async () => null }, { code: t.at14.code, request: { method: 'card', idempotencyKey: 'phone-pay-2' } })).rejects.toMatchObject({ code: 'conflict' });
    await expect(publicPay(db, { clear, card: async () => null }, { code: t.at6.code, request: { method: 'clear', idempotencyKey: 'phone-pay-3' } })).rejects.toMatchObject({ code: 'conflict' });
  });

  test('paying by card is a checkout on the shop’s account; its webhook pays the bill', async () => {
    const t = await tacos();
    const fake = fakeProvider();
    const acct = `acct_${t.merchant.slice(-6)}`;
    await connectorStore.insert(db, { merchant: t.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: t.staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    const order = await tab(t, t.table(14));
    await showOnPoint(db, { merchant: t.merchant, staffId: t.staff.jen, pointId: t.at14.id, request: { kind: 'order', orderId: order.id } });
    expect((await publicPoint(db, t.at14.code)).pay).toEqual({ clear: true, card: true });
    const clear = {} as ClearCharges;
    const started = await publicPay(db, { clear, card: async () => fake.provider }, { code: t.at14.code, request: { method: 'card', idempotencyKey: 'phone-card-1' } });
    expect(started.method).toBe('card');
    const { rows } = await db.query<{ id: string; checkout_session_id: string; application_fee_cents: string }>('SELECT id, checkout_session_id, application_fee_cents FROM payments.tenders WHERE order_id = $1', [order.id]);
    expect(Number(rows[0]!.application_fee_cents)).toBe(30);
    const paymentId = fake.payCheckout(rows[0]!.checkout_session_id);
    const handlers = cardPaymentHandlers(() => fake.provider);
    const event = { type: 'checkout.session.completed', account: acct, data: { object: { id: rows[0]!.checkout_session_id, payment_intent: paymentId } } } as unknown as Stripe.Event;
    await db.transaction((tx) => handlers['checkout.session.completed']!(tx, event));
    expect((await getOrder(db, t.merchant, order.id)).status).toBe('paid');
    expect((await pointStateFor(db, t.at14.id)).state.kind).toBe('paid');
  });
});

describe('Order ready', () => {
  test('Call it shows the number on the counter Point and texts a number left; picked up clears it', async () => {
    const t = await tacos();
    await openDrawer(db, { merchant: t.merchant, staffId: t.staff.jen });
    const { sent, texter } = texts();
    const order = await createOrder(db, deps, { merchant: t.merchant, staffId: t.staff.jen, customer: '(909) 555-0177', lines: [{ itemId: t.pastor.id, quantity: 2, optionIds: [] }] });
    await expect(floor.createAlert(db, texter, { merchant: t.merchant, staffId: t.staff.jen, request: { kind: 'order_ready', orderId: order.id, pointId: null } })).rejects.toMatchObject({ code: 'conflict' });
    await createCashTender(db, { merchant: t.merchant, orderId: order.id, staffId: t.staff.jen, tender: { amountCents: order.totalCents, tipCents: 0, handedOverCents: order.totalCents, idempotencyKey: key() } });
    const alert = await floor.createAlert(db, texter, { merchant: t.merchant, staffId: t.staff.jen, request: { kind: 'order_ready', orderId: order.id, pointId: null } });
    expect(alert).toMatchObject({ pointId: t.counter.id, label: String(order.number), textedTo: '··0177' });
    expect(sent[0]!.message).toContain('is ready. Pick up at the counter.');
    expect((await screenFor(db, t.counter.id)).screen.alert).toEqual({ kind: 'order_ready', label: String(order.number) });
    const picked = await floor.markPickedUp(db, { merchant: t.merchant, staffId: t.staff.jen, orderId: order.id });
    expect(picked.pickedUpAt).not.toBeNull();
    expect((await pointStateFor(db, t.counter.id)).state.kind).toBe('idle');
  });
});

describe('Edit tables', () => {
  test('a table with people at it can’t be taken away; numbers are once each', async () => {
    const t = await tacos();
    const p = await waiting(t, 'Ana', 2);
    await floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: p.id, request: { tableId: t.table(6), showName: true, text: false } });
    const f = await floor.floor(db, t.merchant);
    const keep = f.tables.filter((x) => x.number !== 6).map(({ id, number, label, area, seats }) => ({ id, number, label, area, seats }));
    await expect(floor.saveTables(db, { merchant: t.merchant, staffId: t.staff.owner, tables: keep })).rejects.toMatchObject({ code: 'conflict' });
    await expect(floor.saveTables(db, { merchant: t.merchant, staffId: t.staff.owner, tables: [{ number: 2, label: null, area: null, seats: 2 }, { number: 2, label: null, area: null, seats: 4 }] })).rejects.toMatchObject({ code: 'invalid' });
  });

  test('saving keeps a table, held or not, and two tables can trade numbers', async () => {
    const t = await tacos();
    const p = await waiting(t, 'Ana', 2);
    await floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: p.id, request: { tableId: t.table(6), showName: true, text: false } });
    const rows = (await floor.floor(db, t.merchant)).tables.map(({ id, number, label, area, seats }) => ({ id, number, label, area, seats }));
    const six = rows.find((r) => r.number === 6)!;
    const fourteen = rows.find((r) => r.number === 14)!;
    const swapped = rows.map((r) => (r.id === six.id ? { ...r, number: 14 } : r.id === fourteen.id ? { ...r, number: 6 } : r));
    await floor.saveTables(db, { merchant: t.merchant, staffId: t.staff.owner, tables: [...swapped, { number: 15, label: null, area: null, seats: 2 }] });
    const after = (await floor.floor(db, t.merchant)).tables;
    expect(after.find((x) => x.id === six.id)).toMatchObject({ number: 14, status: 'held' });
    expect(after.find((x) => x.id === fourteen.id)?.number).toBe(6);
    expect(after.map((x) => x.number)).toContain(15);
    expect(after).toHaveLength(rows.length + 1);
  });

  test('changing to a dine-in tab adds to the tab; a second order on a seated table is refused', async () => {
    const t = await tacos();
    const first = await tab(t, t.table(14));
    await expect(tab(t, t.table(14))).rejects.toMatchObject({ code: 'locked' });
    const more = await updateOrder(db, deps, { merchant: t.merchant, orderId: first.id, staffId: t.staff.jen, lines: [{ itemId: t.pastor.id, quantity: 6, optionIds: [] }] });
    expect(more).toMatchObject({ tableId: t.table(14), serviceType: 'dine_in' });
  });
});

describe('Tables v2 (the reference, 8b–8c and 14)', () => {
  test('a walk-in is seated with how many and a name; a held party sits down as themselves', async () => {
    const t = await tacos();
    expect(await floor.seatTable(db, { merchant: t.merchant, staffId: t.staff.jen, tableId: t.table(1), request: { size: 2, name: null } })).toMatchObject({ status: 'seated', party: { name: null, size: 2 } });
    const ana = await waiting(t, 'Ana Ruiz', 2);
    await floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: ana.id, request: { tableId: t.table(6), showName: true, text: false } });
    expect((await floor.getTable(db, t.merchant, t.table(6))).party).toEqual({ name: 'Ana', size: 2 });
    expect(await floor.seatTable(db, { merchant: t.merchant, staffId: t.staff.jen, tableId: t.table(6), request: {} })).toMatchObject({ status: 'seated', hold: null, party: { name: 'Ana', size: 2 } });
    await expect(floor.seatTable(db, { merchant: t.merchant, staffId: t.staff.jen, tableId: t.table(14), request: { size: 0 } })).rejects.toMatchObject({ code: 'invalid' });
  });

  test('Move: the tab, the bill on its Point and the party go to a free table; the old one is free', async () => {
    const t = await tacos();
    await openDrawer(db, { merchant: t.merchant, staffId: t.staff.jen });
    await floor.seatTable(db, { merchant: t.merchant, staffId: t.staff.jen, tableId: t.table(14), request: { size: 4, name: 'Diaz' } });
    const order = await tab(t, t.table(14));
    await showOnPoint(db, { merchant: t.merchant, staffId: t.staff.jen, pointId: t.at14.id, request: { kind: 'order', orderId: order.id } });
    await expect(floor.moveTable(db, { merchant: t.merchant, staffId: t.staff.jen, tableId: t.table(1), request: { toTableId: t.table(6) } })).rejects.toMatchObject({ code: 'conflict' });
    const moved = await floor.moveTable(db, { merchant: t.merchant, staffId: t.staff.jen, tableId: t.table(14), request: { toTableId: t.table(6) } });
    expect(moved.from).toMatchObject({ status: 'free', orderId: null, party: null });
    expect(moved.to).toMatchObject({ orderId: order.id, party: { name: 'Diaz', size: 4 }, tabCents: order.totalCents });
    expect((await pointStateFor(db, t.at6.id)).state).toMatchObject({ kind: 'bill', orderId: order.id });
    expect((await pointStateFor(db, t.at14.id)).state.kind).toBe('idle');
    expect((await getOrder(db, t.merchant, order.id)).tableId).toBe(t.table(6));
    await expect(floor.moveTable(db, { merchant: t.merchant, staffId: t.staff.jen, tableId: t.table(6), request: { toTableId: t.table(6) } })).rejects.toMatchObject({ code: 'invalid' });
  });

  test('a paid table says when it clears itself, and the jobs clear it then; by hand, never', async () => {
    const t = await tacos();
    await openDrawer(db, { merchant: t.merchant, staffId: t.staff.jen });
    const order = await tab(t, t.table(14));
    await createCashTender(db, { merchant: t.merchant, orderId: order.id, staffId: t.staff.jen, tender: { amountCents: order.totalCents, tipCents: 0, handedOverCents: order.totalCents, idempotencyKey: key() } });
    const paid = await floor.getTable(db, t.merchant, t.table(14));
    expect(paid.status).toBe('paid');
    expect(Date.parse(paid.clearsAt!) - Date.parse(paid.paidAt!)).toBe(10 * 60_000);
    await floor.sweepLapsed(db, new Date(Date.parse(paid.paidAt!) + 9 * 60_000));
    expect((await floor.getTable(db, t.merchant, t.table(14))).status).toBe('paid');
    await floor.sweepLapsed(db, new Date(Date.parse(paid.paidAt!) + 10 * 60_000 + 1000));
    expect((await floor.getTable(db, t.merchant, t.table(14))).status).toBe('free');

    const u = await tacos();
    await updateSettings(db, { merchant: u.merchant, staffId: u.staff.owner, patch: { clearPaidAfterMinutes: null } });
    await openDrawer(db, { merchant: u.merchant, staffId: u.staff.jen });
    const o2 = await tab(u, u.table(14));
    await createCashTender(db, { merchant: u.merchant, orderId: o2.id, staffId: u.staff.jen, tender: { amountCents: o2.totalCents, tipCents: 0, handedOverCents: o2.totalCents, idempotencyKey: key() } });
    expect((await floor.getTable(db, u.merchant, u.table(14))).clearsAt).toBeNull();
    await floor.sweepLapsed(db, new Date(Date.now() + 60 * 60_000));
    expect((await floor.getTable(db, u.merchant, u.table(14))).status).toBe('paid');
  });

  test('wait estimates: five minutes a party until a week has three visits, then from table times; or a set time', async () => {
    const t = await tacos();
    await waiting(t, 'Lee', 4);
    expect((await floor.waitlist(db, t.merchant)).quotedMinutes).toBe(10);
    // Three visits of 45 minutes this week, over three tables: two parties (Lee, then whoever joins) is 2 × 45 / 3 = 30.
    const now = new Date();
    for (let i = 0; i < 3; i += 1) {
      await floor.seatTable(db, { merchant: t.merchant, staffId: t.staff.jen, tableId: t.table(1), request: { size: 2, name: null }, now: new Date(now.getTime() - (i + 1) * 3 * 3600_000) });
      await floor.clearTable(db, { merchant: t.merchant, staffId: t.staff.jen, tableId: t.table(1), now: new Date(now.getTime() - (i + 1) * 3 * 3600_000 + 45 * 60_000) });
    }
    expect(await floor.waitEstimate(db, t.merchant, 1)).toBe(30);
    expect((await floor.waitlist(db, t.merchant)).quotedMinutes).toBe(30);
    await updateSettings(db, { merchant: t.merchant, staffId: t.staff.owner, patch: { waitEstimate: 20 } });
    expect((await floor.waitlist(db, t.merchant)).quotedMinutes).toBe(20);
    const told = await floor.addParty(db, { merchant: t.merchant, staffId: t.staff.jen, party: { name: 'Priya', size: 2, phone: null, textConsent: false, quotedMinutes: 15 } });
    expect(told.quotedMinutes).toBe(15);
  });

  test('the wait list’s texts: joined, almost ready, ready; only with consent, only while the shop texts', async () => {
    const t = await tacos();
    const { sent, texter } = texts();
    const priya = await floor.addParty(db, { merchant: t.merchant, staffId: t.staff.jen, party: { name: 'Priya', size: 2, phone: '(909) 555-0142', textConsent: true, quotedMinutes: 15 }, texter });
    expect(sent.at(-1)?.message).toMatch(/: you’re on the wait list, about 15 min\. We’ll text when your table is almost ready\. Reply STOP to stop\.$/);
    expect(await floor.notifyParty(db, texter, { merchant: t.merchant, staffId: t.staff.jen, partyId: priya.id })).toMatchObject({ state: 'notified', notifiedAt: expect.any(String) });
    expect(sent.at(-1)?.message).toMatch(/: your table is almost ready\. Head back when you can\.$/);
    const marco = await floor.addParty(db, { merchant: t.merchant, staffId: t.staff.jen, party: { name: 'Marco', size: 3, phone: null, textConsent: false }, texter });
    expect(sent).toHaveLength(2);
    await expect(floor.notifyParty(db, texter, { merchant: t.merchant, staffId: t.staff.jen, partyId: marco.id })).rejects.toMatchObject({ code: 'invalid' });

    await updateSettings(db, { merchant: t.merchant, staffId: t.staff.owner, patch: { textWaitlist: false } });
    await floor.addParty(db, { merchant: t.merchant, staffId: t.staff.jen, party: { name: 'Lee', size: 4, phone: '(909) 555-0177', textConsent: true }, texter });
    expect(sent).toHaveLength(2);
    await expect(floor.notifyParty(db, texter, { merchant: t.merchant, staffId: t.staff.jen, partyId: priya.id })).rejects.toMatchObject({ code: 'conflict', message: 'Texting the wait list is off in Settings › Counter' });
    await expect(floor.seatParty(db, texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: priya.id, request: { tableId: t.table(6), showName: true, text: true } })).rejects.toMatchObject({ code: 'conflict' });
  });

  test('No show and Remove take a party off the list; a seated party can’t be a no show', async () => {
    const t = await tacos();
    const lee = await waiting(t, 'Lee', 4);
    const marco = await waiting(t, 'Marco', 3);
    expect(await floor.noShowParty(db, { merchant: t.merchant, staffId: t.staff.jen, partyId: lee.id })).toMatchObject({ state: 'no_show' });
    expect(await floor.updateParty(db, { merchant: t.merchant, staffId: t.staff.jen, partyId: marco.id, patch: { state: 'removed' } })).toMatchObject({ state: 'removed' });
    expect((await floor.waitlist(db, t.merchant)).parties).toEqual([]);
    const ana = await waiting(t, 'Ana', 2);
    await floor.seatParty(db, texts().texter, { merchant: t.merchant, staffId: t.staff.manager, partyId: ana.id, request: { tableId: t.table(1), showName: true, text: false } });
    await expect(floor.noShowParty(db, { merchant: t.merchant, staffId: t.staff.jen, partyId: ana.id })).rejects.toMatchObject({ code: 'conflict' });
  });

  test('Edit tables links a Point to a table, and the one that was there lets go', async () => {
    const t = await tacos();
    const rows = (await floor.floor(db, t.merchant)).tables.map(({ id, number, label, area, seats }) => ({ id, number, label, area, seats }));
    await floor.saveTables(db, { merchant: t.merchant, staffId: t.staff.owner, tables: rows.map((r) => (r.number === 6 ? { ...r, pointId: t.at14.id } : r)) });
    const f = await floor.floor(db, t.merchant);
    expect(f.tables.find((x) => x.number === 6)?.point?.id).toBe(t.at14.id);
    expect(f.tables.find((x) => x.number === 14)?.point).toBeNull();
    const hw = await listHardware(db, t.merchant);
    expect(hw.find((d) => d.id === t.at6.id)).toMatchObject({ settings: { tableId: null } });
    expect(hw.find((d) => d.id === t.at14.id)).toMatchObject({ settings: { tableId: t.table(6), placement: 'table' } });
    await floor.saveTables(db, { merchant: t.merchant, staffId: t.staff.owner, tables: rows.map((r) => (r.number === 6 ? { ...r, pointId: null } : r)) });
    expect((await floor.floor(db, t.merchant)).tables.find((x) => x.number === 6)?.point).toBeNull();
  });
});
