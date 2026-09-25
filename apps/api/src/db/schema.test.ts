import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from './db.js';
import { seedShop, testDb } from './testDb.js';

/**
 * What the commerce and payments tables refuse on their own, whatever writes to them. The services
 * built in later phases check the same things first; these are the backstop.
 */

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

let seq = 0;
const id = (p: string) => `${p}_${++seq}`;

async function item(merchant: string, patch: { stock?: boolean } = {}) {
  const itemId = id('itm');
  await db.query(
    `INSERT INTO commerce.catalog_items (id, merchant, name, category, price_cents, tax_kind, stock_tracked) VALUES ($1, $2, 'Brake pads', 'Parts', 4800, 'goods', $3)`,
    [itemId, merchant, patch.stock ?? true],
  );
  return itemId;
}

async function order(merchant: string, raisedBy: string, figures = { subtotal: 4800, discount: 0, tax: 372 }) {
  const orderId = id('ord');
  await db.query(
    `INSERT INTO commerce.orders (id, merchant, raised_by, subtotal_cents, discount_cents, tax_cents, total_cents, business_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-09-22')`,
    [orderId, merchant, raisedBy, figures.subtotal, figures.discount, figures.tax, figures.subtotal - figures.discount + figures.tax],
  );
  return orderId;
}

async function line(orderId: string, itemId: string | null, quantity = 1) {
  const lineId = id('oln');
  await db.query(
    `INSERT INTO commerce.order_lines (id, order_id, item_id, name, quantity, unit_cents, line_cents, tax_kind) VALUES ($1, $2, $3, 'Brake pads', $4, 4800, $5, 'goods')`,
    [lineId, orderId, itemId, quantity, 4800 * quantity],
  );
  return lineId;
}

const move = (merchant: string, itemId: string, kind: string, quantity: number, orderLineId: string | null = null) =>
  db.query(`INSERT INTO commerce.stock_movements (id, merchant, item_id, kind, quantity, order_line_id) VALUES ($1, $2, $3, $4, $5, $6)`, [
    id('mov'),
    merchant,
    itemId,
    kind,
    quantity,
    orderLineId,
  ]);

const level = async (itemId: string) =>
  (await db.query<{ on_hand: number; held: number; free: number }>('SELECT on_hand, held, free FROM commerce.stock_levels WHERE item_id = $1', [itemId])).rows[0];

describe('stock is movements', () => {
  test('on hand, held and free are sums', async () => {
    const { merchant, staff } = await seedShop(db);
    const pads = await item(merchant);
    await move(merchant, pads, 'receive', 8);
    const o = await order(merchant, staff.jen);
    const l = await line(o, pads, 2);
    await move(merchant, pads, 'hold', 2, l);
    expect(await level(pads)).toEqual({ on_hand: 8, held: 2, free: 6 });
    // Paid: the hold is released and the stock sold.
    await move(merchant, pads, 'release', -2, l);
    await move(merchant, pads, 'sell', -2, l);
    await move(merchant, pads, 'damage', -1);
    expect(await level(pads)).toEqual({ on_hand: 5, held: 0, free: 5 });
  });

  test('each kind moves the right way, and a movement is never edited', async () => {
    const { merchant } = await seedShop(db);
    const pads = await item(merchant);
    await expect(move(merchant, pads, 'receive', -1)).rejects.toThrow();
    await expect(move(merchant, pads, 'damage', 1)).rejects.toThrow();
    await expect(move(merchant, pads, 'hold', 1)).rejects.toThrow(); // a hold needs its order line
    await move(merchant, pads, 'count', -2);
    await expect(db.query('UPDATE commerce.stock_movements SET quantity = 5 WHERE item_id = $1', [pads])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM commerce.stock_movements WHERE item_id = $1', [pads])).rejects.toThrow('append-only');
  });
});

describe('orders', () => {
  test('the total is subtotal − discount + tax', async () => {
    const { merchant, staff } = await seedShop(db);
    await expect(
      db.query(
        `INSERT INTO commerce.orders (id, merchant, raised_by, subtotal_cents, discount_cents, tax_cents, total_cents, business_date) VALUES ('ord_bad', $1, $2, 1000, 0, 80, 1000, '2026-09-22')`,
        [merchant, staff.jen],
      ),
    ).rejects.toThrow();
  });

  test('one live discount, and the approver is someone else', async () => {
    const { merchant, staff } = await seedShop(db);
    const o = await order(merchant, staff.jen);
    const discount = (approvedBy: string | null) =>
      db.query(
        `INSERT INTO commerce.order_discounts (id, order_id, kind, label, percent, amount_cents, reason, applied_by, approved_by) VALUES ($1, $2, 'manual', '15%', 15, 720, 'Returning customer', $3, $4)`,
        [id('odc'), o, staff.jen, approvedBy],
      );
    await expect(discount(staff.jen)).rejects.toThrow();
    await discount(staff.manager);
    await expect(discount(null)).rejects.toThrow();
  });

  test('a discount code takes off a percent or an amount, not both', async () => {
    const { merchant } = await seedShop(db);
    await expect(
      db.query(`INSERT INTO commerce.discount_codes (id, merchant, code, percent, amount_cents) VALUES ('dc_bad', $1, 'FALL10', 10, 500)`, [merchant]),
    ).rejects.toThrow();
  });
});

describe('tenders', () => {
  async function drawer(merchant: string, openedBy: string) {
    const s = id('drw');
    await db.query(`INSERT INTO payments.drawer_sessions (id, merchant, business_date, opened_by, starting_cash_cents) VALUES ($1, $2, '2026-09-22', $3, 15000)`, [s, merchant, openedBy]);
    return s;
  }
  const cash = (merchant: string, orderId: string, by: string, session: string | null, handed: number, change: number, key = id('idem')) =>
    db.query(
      `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, tip_cents, idempotency_key, request_hash, created_by, drawer_session_id, handed_over_cents, change_cents, status)
       VALUES ($1, $2, $3, 'cash', 5172, 0, $4, 'h', $5, $6, $7, $8, 'approved')`,
      [id('tnd'), merchant, orderId, key, by, session, handed, change],
    );

  test('cash: handed over is the amount, the tip and the change, into a drawer', async () => {
    const { merchant, staff } = await seedShop(db);
    const o = await order(merchant, staff.jen);
    const s = await drawer(merchant, staff.jen);
    await cash(merchant, o, staff.jen, s, 6000, 828);
    await expect(cash(merchant, o, staff.jen, s, 6000, 800)).rejects.toThrow();
    await expect(cash(merchant, o, staff.jen, null, 6000, 828)).rejects.toThrow();
  });

  test('an idempotency key is used once per shop', async () => {
    const { merchant, staff } = await seedShop(db);
    const o = await order(merchant, staff.jen);
    const s = await drawer(merchant, staff.jen);
    await cash(merchant, o, staff.jen, s, 6000, 828, 'same-key');
    await expect(cash(merchant, o, staff.jen, s, 6000, 828, 'same-key')).rejects.toThrow();
  });

  test('never refunded past what it took, and a card is never "approved"', async () => {
    const { merchant, staff } = await seedShop(db);
    const o = await order(merchant, staff.jen);
    await expect(
      db.query(
        `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, idempotency_key, request_hash, created_by, status) VALUES ($1, $2, $3, 'card', 5172, $4, 'h', $5, 'approved')`,
        [id('tnd'), merchant, o, id('k'), staff.jen],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, refunded_cents, idempotency_key, request_hash, created_by, status) VALUES ($1, $2, $3, 'card', 5172, 5173, $4, 'h', $5, 'refunded')`,
        [id('tnd'), merchant, o, id('k'), staff.jen],
      ),
    ).rejects.toThrow();
  });

  test('one open drawer per shop', async () => {
    const { merchant, staff } = await seedShop(db);
    await drawer(merchant, staff.jen);
    await expect(drawer(merchant, staff.luis)).rejects.toThrow();
  });
});

describe('the drawer at close', () => {
  async function session() {
    const shop = await seedShop(db);
    const s = id('drw');
    await db.query(`INSERT INTO payments.drawer_sessions (id, merchant, business_date, opened_by, starting_cash_cents, status) VALUES ($1, $2, '2026-09-22', $3, 15000, 'counting')`, [
      s,
      shop.merchant,
      shop.staff.jen,
    ]);
    return { ...shop, s };
  }
  const count = (s: string, counter: string, second: boolean, total = 20800) =>
    db.query(`INSERT INTO payments.drawer_counts (id, session_id, counter, method, total_cents, second) VALUES ($1, $2, $3, 'total', $4, $5)`, [id('cnt'), s, counter, total, second]);
  const signOff = (s: string, by: string) =>
    db.query(`INSERT INTO payments.drawer_signoffs (id, session_id, difference_cents, note, signed_by) VALUES ($1, $2, -379, 'Short a few coins', $3)`, [id('sgn'), s, by]);

  test('the second count is someone else', async () => {
    const { staff, s } = await session();
    await count(s, staff.manager, false);
    await expect(count(s, staff.manager, true)).rejects.toThrow('someone other than the first counter');
    await count(s, staff.luis, true);
    await expect(count(s, staff.owner, true)).rejects.toThrow(); // one live second count
  });

  test('a difference is signed off by a manager or owner who was not the first counter', async () => {
    const { staff, s } = await session();
    await count(s, staff.manager, false);
    await count(s, staff.luis, true);
    await expect(signOff(s, staff.manager)).rejects.toThrow('other than the first counter');
    await expect(signOff(s, staff.luis)).rejects.toThrow('manager or an owner');
    await signOff(s, staff.owner);
    await expect(db.query('DELETE FROM payments.drawer_signoffs WHERE session_id = $1', [s])).rejects.toThrow('immutable');
  });

  test('a day report is locked once written', async () => {
    const { merchant, staff, s } = await session();
    await db.query(`INSERT INTO payments.day_reports (id, merchant, session_id, business_date, report, closed_by) VALUES ('rpt_1', $1, $2, '2026-09-22', '{"takenCents": 0}', $3)`, [
      merchant,
      s,
      staff.owner,
    ]);
    await expect(db.query(`UPDATE payments.day_reports SET report = '{}' WHERE id = 'rpt_1'`)).rejects.toThrow('immutable');
  });

  test('a redelivered Stripe event is one row', async () => {
    const insert = () =>
      db.query(
        `INSERT INTO payments.stripe_events (event_id, endpoint, type, account, livemode, payload) VALUES ('evt_1', 'connect', 'payment_intent.succeeded', 'acct_1', false, '{}') ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      );
    expect((await insert()).rows).toHaveLength(1);
    expect((await insert()).rows).toHaveLength(0);
  });
});

describe('shop settings', () => {
  test('defaults match the contract, and nonsense is refused', async () => {
    const { merchant } = await seedShop(db);
    await db.query('INSERT INTO merchant.shop_settings (merchant) VALUES ($1)', [merchant]);
    const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM merchant.shop_settings WHERE merchant = $1', [merchant]);
    expect(rows[0]).toMatchObject({ tips_mode: 'amounts', tips_presets: [500, 1000, 2000], starting_cash_cents: 15000, discount_limit_counter: 10, discount_limit_manager: 25, discount_limit_owner: null });
    await expect(db.query(`UPDATE merchant.shop_settings SET tips_presets = '{1,2,3,4,5}' WHERE merchant = $1`, [merchant])).rejects.toThrow();
    await expect(db.query(`UPDATE merchant.shop_settings SET discount_limit_counter = 101 WHERE merchant = $1`, [merchant])).rejects.toThrow();
  });

  test('a paid card plan carries its fee; pay-as-you-go does not', async () => {
    const { merchant } = await seedShop(db);
    await expect(db.query(`UPDATE merchant.profiles SET card_plan = 'paid' WHERE merchant = $1`, [merchant])).rejects.toThrow();
    await db.query(`UPDATE merchant.profiles SET card_plan = 'paid', card_plan_fee_cents = 20 WHERE merchant = $1`, [merchant]);
  });

  test('one live card connector per shop', async () => {
    const { merchant } = await seedShop(db);
    const connect = (acct: string) =>
      db.query(`INSERT INTO merchant.card_connectors (id, merchant, provider, external_account_id) VALUES ($1, $2, 'stripe', $3)`, [id('cc'), merchant, acct]);
    await connect('acct_a');
    await expect(connect('acct_b')).rejects.toThrow();
    await db.query('UPDATE merchant.card_connectors SET disconnected_at = now() WHERE merchant = $1', [merchant]);
    await connect('acct_b');
  });
});
