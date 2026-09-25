import { beforeAll, describe, expect, test } from 'bun:test';
import { PAY_OVER_TIME_MIN_CENTS, splitsOffered } from '@clear/domain';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import * as catalog from '../catalog/catalogService.js';
import { createCardTender, syncCardTender } from '../cards/cardTenders.js';
import { connectorStore } from '../cards/connectorStore.js';
import { fakeProvider } from '../cards/fakeProvider.js';
import { currentDrawer, openDrawer } from '../drawer/drawerService.js';
import { tipsPayable } from '../ledger/accounts.js';
import { balance } from '../ledger/ledgerService.js';
import { updateSettings } from '../shop/shopService.js';
import { createOrder, getOrder, type OrderDeps } from './orderService.js';
import { cancelClearTender, type ClearCharges, createCashTender, createClearTender, syncClearTender, voidOrder } from './payments.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

/** The Clear charge flow for tests: raise gives a code; the test plays the member. */
function fakeClear(opts: { refuse?: string } = {}) {
  const charges = new Map<string, 'pending' | 'approved' | 'declined' | 'expired' | 'cancelled'>();
  const raised: Array<{ amountCents: number }> = [];
  let n = 0;
  const clear: ClearCharges = {
    async raise({ amountCents }) {
      if (opts.refuse) return { ok: false, reason: opts.refuse };
      raised.push({ amountCents });
      const code = `CLR${++n}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      charges.set(code, 'pending');
      return { ok: true, code };
    },
    async status(code) {
      return charges.get(code) ?? null;
    },
    async cancel(code) {
      if (charges.get(code) !== 'pending') return false;
      charges.set(code, 'cancelled');
      return true;
    },
  };
  return { clear, charges, raised };
}

let seq = 0;
const key = () => `k-${++seq}-${Math.random().toString(36).slice(2, 6)}`;
const noTax: OrderDeps = { taxApi: null, pinCheck: async () => null };

async function shop() {
  const s = await seedShop(db);
  const tire = await catalog.createItem(db, { merchant: s.merchant, staffId: s.staff.owner, item: { name: 'Michelin Defender2', detail: null, category: 'Tires', priceCents: 18900, costCents: null, taxKind: 'goods', stockTracked: true, reorderAt: null } });
  await catalog.adjustStock(db, { merchant: s.merchant, staffId: s.staff.owner, adjustment: { itemId: tire.id, kind: 'receive', quantity: 8, reason: null } });
  const order = (qty = 1) => createOrder(db, noTax, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: tire.id, quantity: qty, optionIds: [] }] });
  const pins = { '1111': { id: s.staff.manager, role: 'manager' as const }, '4821': { id: s.staff.jen, role: 'counter' as const } };
  const pinCheck: OrderDeps['pinCheck'] = async (_m, p) => pins[p as keyof typeof pins] ?? null;
  return { ...s, tire, order, pinCheck };
}

const cash = (s: { merchant: string; staff: { jen: string } }, orderId: string, amountCents: number, handedOverCents: number, tipCents = 0) =>
  createCashTender(db, { merchant: s.merchant, orderId, staffId: s.staff.jen, tender: { amountCents, tipCents, handedOverCents, idempotencyKey: key() } });

describe('the drawer', () => {
  test('opens once with the starting cash, and books the float the first time', async () => {
    const s = await shop();
    const d = await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    expect(d).toMatchObject({ startingCashCents: 15000, status: 'open', openedBy: s.staff.jen });
    expect(await balance(db, s.merchant, 'drawer_cash')).toBe(15000);
    await expect(openDrawer(db, { merchant: s.merchant, staffId: s.staff.luis })).rejects.toMatchObject({ code: 'already_open' });
    expect((await currentDrawer(db, s.merchant))!.id).toBe(d.id);
  });
});

describe('cash', () => {
  test('handed over, change worked out, into the drawer; the sale is booked with the tip', async () => {
    const s = await shop();
    await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    const o = await s.order();
    const t = await cash(s, o.id, 18900, 20000, 500);
    expect(t).toMatchObject({ method: 'cash', status: 'approved', handedOverCents: 20000, changeCents: 600, tipCents: 500 });
    expect((await getOrder(db, s.merchant, o.id)).status).toBe('paid');
    expect(await balance(db, s.merchant, 'drawer_cash')).toBe(15000 + 18900 + 500);
    expect(await balance(db, s.merchant, tipsPayable(s.staff.jen))).toBe(500);
  });

  test('short is refused; no drawer, no cash; a retry is the same payment', async () => {
    const s = await shop();
    const o = await s.order();
    await expect(cash(s, o.id, 18900, 20000)).rejects.toMatchObject({ code: 'drawer_closed' });
    await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    await expect(cash(s, o.id, 18900, 18000)).rejects.toMatchObject({ code: 'short' });
    const k = key();
    const body = { amountCents: 18900, tipCents: 0, handedOverCents: 20000, idempotencyKey: k };
    const a = await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: body });
    const b = await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: body });
    expect(b.id).toBe(a.id);
    await expect(createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { ...body, handedOverCents: 19000 } })).rejects.toMatchObject({ code: 'key_reused' });
  });
});

describe('splitting', () => {
  test('cash then Clear for the rest; the order is paid when the member approves', async () => {
    const s = await shop();
    await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    const o = await s.order(2);
    const c = fakeClear();
    await cash(s, o.id, 10000, 10000);
    expect((await getOrder(db, s.merchant, o.id))).toMatchObject({ status: 'paying', remainingCents: 27800 });
    const t = await createClearTender(db, c.clear, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 27800, tipCents: 0, idempotencyKey: key() } });
    expect(t).toMatchObject({ method: 'clear', status: 'pending' });
    expect(t.clearChargeCode).toBeTruthy();
    c.charges.set(t.clearChargeCode!, 'approved');
    expect((await syncClearTender(db, c.clear, { merchant: s.merchant, tenderId: t.id, actor: null })).status).toBe('approved');
    expect((await getOrder(db, s.merchant, o.id)).status).toBe('paid');
    expect(await balance(db, s.merchant, 'clear_receivable')).toBe(27800);
  });

  test('a declined Clear part keeps the cash paid and the rest owed', async () => {
    const s = await shop();
    await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    const o = await s.order(2);
    const c = fakeClear();
    await cash(s, o.id, 10000, 10000);
    const t = await createClearTender(db, c.clear, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 27800, tipCents: 0, idempotencyKey: key() } });
    c.charges.set(t.clearChargeCode!, 'declined');
    expect((await syncClearTender(db, c.clear, { merchant: s.merchant, tenderId: t.id, actor: null })).status).toBe('declined');
    expect(await getOrder(db, s.merchant, o.id)).toMatchObject({ status: 'paying', remainingCents: 27800 });
    // An expired one ends as cancelled, and a withdrawn one too.
    const u = await createClearTender(db, c.clear, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 27800, tipCents: 0, idempotencyKey: key() } });
    c.charges.set(u.clearChargeCode!, 'expired');
    expect((await syncClearTender(db, c.clear, { merchant: s.merchant, tenderId: u.id, actor: null })).status).toBe('cancelled');
  });

  test('more than is owed, counting what’s in flight, is refused; with splitting off, one payment for the whole', async () => {
    const s = await shop();
    await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    const o = await s.order(2);
    const c = fakeClear();
    await createClearTender(db, c.clear, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 30000, tipCents: 0, idempotencyKey: key() } });
    await expect(cash(s, o.id, 7801, 7801)).rejects.toMatchObject({ code: 'over_remaining' });
    await updateSettings(db, { merchant: s.merchant, staffId: s.staff.owner, patch: { paymentMethods: { card: true, cash: true, split: false } } });
    const whole = await s.order();
    await expect(cash(s, whole.id, 10000, 10000)).rejects.toMatchObject({ code: 'split_off' });
    expect((await cash(s, whole.id, 18900, 20000)).status).toBe('approved');
  });

  test('a card for part: the shared rules apply to cards too', async () => {
    const s = await shop();
    const fake = fakeProvider();
    const acct = `acct_split_${s.merchant.slice(-6)}`;
    const cc = await connectorStore.insert(db, { merchant: s.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: s.staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1,$2,$3,'stripe','m2',$4,'M2')`, [`rdr_sp_${s.merchant.slice(-6)}`, s.merchant, cc.id, `M2-${s.merchant}`]);
    await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    const o = await s.order(2);
    await cash(s, o.id, 20000, 20000);
    const start = await createCardTender(db, fake.provider, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, amountCents: 17800, tipCents: 0, readerId: `rdr_sp_${s.merchant.slice(-6)}`, idempotencyKey: key() });
    fake.tap(fake.payments.values().next().value!.id);
    await syncCardTender(db, fake.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: null });
    expect((await getOrder(db, s.merchant, o.id)).status).toBe('paid');
  });
});

describe('Clear', () => {
  test('the charge carries the tip; a refused raise withdraws the tender', async () => {
    const s = await shop();
    const o = await s.order();
    const c = fakeClear();
    await createClearTender(db, c.clear, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 18900, tipCents: 1000, idempotencyKey: key() } });
    expect(c.raised).toEqual([{ amountCents: 19900 }]);
    const refusing = fakeClear({ refuse: 'amount is over this merchant’s approval cap' });
    const o2 = await s.order();
    await expect(createClearTender(db, refusing.clear, { merchant: s.merchant, orderId: o2.id, staffId: s.staff.jen, tender: { amountCents: 18900, tipCents: 0, idempotencyKey: key() } })).rejects.toMatchObject({
      code: 'clear_refused',
    });
    expect((await getOrder(db, s.merchant, o2.id))).toMatchObject({ status: 'open', remainingCents: 18900 });
  });

  test('withdrawn before the member answers; after they approve, it’s the Clear refund flow', async () => {
    const s = await shop();
    const c = fakeClear();
    const o = await s.order();
    const t = await createClearTender(db, c.clear, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 18900, tipCents: 0, idempotencyKey: key() } });
    expect((await cancelClearTender(db, c.clear, { merchant: s.merchant, tenderId: t.id, actor: s.staff.jen })).status).toBe('cancelled');
    const o2 = await s.order();
    const u = await createClearTender(db, c.clear, { merchant: s.merchant, orderId: o2.id, staffId: s.staff.jen, tender: { amountCents: 18900, tipCents: 0, idempotencyKey: key() } });
    // The member approves just as the counter cancels: the tender follows the member's answer.
    c.charges.set(u.clearChargeCode!, 'approved');
    expect((await cancelClearTender(db, c.clear, { merchant: s.merchant, tenderId: u.id, actor: s.staff.jen })).status).toBe('approved');
    await expect(cancelClearTender(db, c.clear, { merchant: s.merchant, tenderId: u.id, actor: s.staff.jen })).rejects.toMatchObject({ code: 'not_voidable' });
  });

  test('pay over time starts at $50.00; under it, the only choice is in full', () => {
    expect(PAY_OVER_TIME_MIN_CENTS).toBe(5000);
    expect(splitsOffered(4999, [1, 2, 4, 12])).toEqual([1]);
    expect(splitsOffered(5000, [1, 2, 4, 12])).toEqual([1, 2, 4, 12]);
  });
});

describe('voiding an order', () => {
  test('cash back out of the drawer, the sale reversed, the stock released', async () => {
    const s = await shop();
    await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    const o = await s.order(2);
    await cash(s, o.id, 37800, 40000);
    const voided = await voidOrder(db, { card: null, clear: fakeClear().clear, pinCheck: s.pinCheck }, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, pin: '1111', today: o.businessDate });
    expect(voided.status).toBe('voided');
    expect(await balance(db, s.merchant, 'drawer_cash')).toBe(15000);
    expect(await balance(db, s.merchant, 'sales')).toBe(0);
    const { rows } = await db.query<{ on_hand: number; held: number }>('SELECT on_hand, held FROM commerce.stock_levels WHERE item_id = $1', [s.tire.id]);
    expect(rows[0]).toEqual({ on_hand: 8, held: 0 });
  });

  test('a card hold is released and a pending Clear charge withdrawn', async () => {
    const s = await shop();
    const c = fakeClear();
    const o = await s.order(2);
    await createClearTender(db, c.clear, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 37800, tipCents: 0, idempotencyKey: key() } });
    const v = await voidOrder(db, { card: null, clear: c.clear, pinCheck: s.pinCheck }, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, pin: '1111', today: o.businessDate });
    expect(v.status).toBe('voided');
    expect([...c.charges.values()]).toEqual(['cancelled']);
  });

  test('needs a manager’s or owner’s PIN, today, and nothing already settled', async () => {
    const s = await shop();
    const c = fakeClear();
    const o = await s.order();
    const deps = { card: null, clear: c.clear, pinCheck: s.pinCheck };
    await expect(voidOrder(db, deps, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, pin: '4821', today: o.businessDate })).rejects.toMatchObject({ code: 'approver_invalid' });
    await expect(voidOrder(db, deps, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, pin: '1111', today: '2099-01-01' })).rejects.toMatchObject({ code: 'not_same_day' });
    const t = await createClearTender(db, c.clear, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 18900, tipCents: 0, idempotencyKey: key() } });
    c.charges.set(t.clearChargeCode!, 'approved');
    await syncClearTender(db, c.clear, { merchant: s.merchant, tenderId: t.id, actor: null });
    await expect(voidOrder(db, deps, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, pin: '1111', today: o.businessDate })).rejects.toMatchObject({ code: 'not_voidable' });
  });
});
