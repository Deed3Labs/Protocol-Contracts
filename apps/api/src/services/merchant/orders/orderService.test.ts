import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import * as catalog from '../catalog/catalogService.js';
import { connectorStore } from '../cards/connectorStore.js';
import { updateSettings } from '../shop/shopService.js';
import type { TaxApi, TaxLine } from '../tax/taxApi.js';
import { forgetTaxStatus, taxAtRate, taxStatus } from '../tax/taxService.js';
import { allocate, applyDiscount, businessDate, createOrder, getOrder, type OrderDeps, removeDiscount, updateOrder } from './orderService.js';
import { settleOrder } from './settle.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

/** Stripe Tax for tests: 7.75% on goods and prepared food, labour untaxed, in California. */
function fakeTax(opts: { collecting?: boolean; shopStatus?: 'active' | 'setup_needed' } = {}) {
  const calls: Array<{ account: string | null; lines: TaxLine[]; inclusive: boolean }> = [];
  const RATE: Record<string, number> = { goods: 77500, food: 77500, labour: 0, exempt: 0 };
  const api: TaxApi = {
    async status() {
      return opts.shopStatus ?? 'setup_needed';
    },
    async calculate(account, { lines, inclusive }) {
      calls.push({ account, lines, inclusive });
      const collecting = opts.collecting ?? true;
      return {
        calculationId: `taxcalc_${calls.length}`,
        taxByLine: new Map(lines.map((l) => [l.reference, collecting ? taxAtRate(l.amountCents, RATE[l.taxKind]!, inclusive) : 0])),
        rateByLine: new Map(lines.map((l) => [l.reference, collecting ? RATE[l.taxKind]! : null])),
      };
    },
  };
  return { api, calls };
}

async function mikesTire(opts: { address?: boolean } = {}) {
  const shop = await seedShop(db);
  if (opts.address ?? true) {
    await db.query(`UPDATE merchant.profiles SET address_line1 = '412 Colton Ave', address_city = 'Redlands', address_region = 'CA', address_postal_code = '92374' WHERE merchant = $1`, [shop.merchant]);
  }
  const add = (item: object) => catalog.createItem(db, { merchant: shop.merchant, staffId: shop.staff.owner, item });
  const tire = await add({ name: 'Michelin Defender2', detail: null, category: 'Tires', priceCents: 18900, costCents: 13200, taxKind: 'goods', stockTracked: true, reorderAt: 4 });
  const mount = await add({ name: 'Mount and balance', detail: null, category: 'Labour', priceCents: 2500, costCents: null, taxKind: 'labour', stockTracked: false, reorderAt: null });
  const stems = await add({ name: 'Valve stems, set of 4', detail: null, category: 'Parts', priceCents: 1200, costCents: 400, taxKind: 'goods', stockTracked: false, reorderAt: null });
  await catalog.adjustStock(db, { merchant: shop.merchant, staffId: shop.staff.owner, adjustment: { itemId: tire.id, kind: 'receive', quantity: 8, reason: null } });
  const withHazard = await catalog.saveOptionGroups(db, {
    merchant: shop.merchant,
    itemId: tire.id,
    groups: [
      { name: 'Road hazard', rule: 'one', required: false, position: 0, options: [{ name: 'Warranty', deltaCents: 2000, position: 0 }] },
      { name: 'Install', rule: 'one', required: false, position: 1, options: [{ name: 'Bay 1', deltaCents: 0, position: 0 }, { name: 'Bay 2', deltaCents: 0, position: 1 }] },
    ],
  });
  const ticket = [
    { itemId: tire.id, quantity: 4, optionIds: [] },
    { itemId: mount.id, quantity: 4, optionIds: [] },
    { itemId: stems.id, quantity: 1, optionIds: [] },
  ];
  return { ...shop, tire, mount, stems, withHazard, ticket };
}

const level = async (itemId: string) => (await db.query<{ on_hand: number; held: number; free: number }>('SELECT on_hand, held, free FROM commerce.stock_levels WHERE item_id = $1', [itemId])).rows[0]!;

describe('raising an order', () => {
  test('the reference ticket: $768 of parts, $100 of labour, 7.75% on the parts, $927.52', async () => {
    const s = await mikesTire();
    const tax = fakeTax();
    const deps: OrderDeps = { taxApi: tax.api, pinCheck: async () => null };
    const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: s.ticket, customer: 'Ray C.' });
    expect(o).toMatchObject({ status: 'open', subtotalCents: 86800, discountCents: 0, taxCents: 5952, totalCents: 92752, taxSource: 'address_rate', taxIncluded: false, remainingCents: 92752, number: 1, customer: 'Ray C.' });
    expect(o.lines.map((l) => [l.name, l.lineCents, l.taxCents])).toEqual([
      ['Michelin Defender2', 75600, 5859],
      ['Mount and balance', 10000, 0],
      ['Valve stems, set of 4', 1200, 93],
    ]);
    // The rate was looked up once for the address, on Clear's own account, and kept.
    expect(tax.calls.filter((c) => c.account === null)).toHaveLength(1);
    await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: s.stems.id, quantity: 1, optionIds: [] }] });
    expect(tax.calls.filter((c) => c.account === null)).toHaveLength(1);
  });

  test('its stock is held; more than is free is refused', async () => {
    const s = await mikesTire();
    const deps: OrderDeps = { taxApi: fakeTax().api, pinCheck: async () => null };
    await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: s.ticket });
    expect(await level(s.tire.id)).toEqual({ on_hand: 8, held: 4, free: 4 });
    await expect(createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: s.tire.id, quantity: 5, optionIds: [] }] })).rejects.toMatchObject({
      code: 'out_of_stock',
      message: 'Only 4 Michelin Defender2 left',
    });
  });

  test('options: priced into the line, snapshotted, and held to their group’s rule', async () => {
    const s = await mikesTire();
    const deps: OrderDeps = { taxApi: fakeTax().api, pinCheck: async () => null };
    const [hazard, install] = s.withHazard.optionGroups;
    const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: s.tire.id, quantity: 2, optionIds: [hazard!.options[0]!.id] }] });
    expect(o.lines[0]).toMatchObject({ unitCents: 20900, lineCents: 41800, options: [{ name: 'Warranty', deltaCents: 2000 }] });
    await expect(
      createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: s.tire.id, quantity: 1, optionIds: install!.options.map((x) => x.id) }] }),
    ).rejects.toMatchObject({ message: 'Pick one Install' });
    await expect(createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: s.tire.id, quantity: 1, optionIds: ['opt_elsewhere'] }] })).rejects.toMatchObject({ code: 'invalid' });
  });

  test('a quick sale is taxed by its kind and holds no stock', async () => {
    const s = await mikesTire();
    const deps: OrderDeps = { taxApi: fakeTax().api, pinCheck: async () => null };
    const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'Patch, rear left tire', note: 'nail', amountCents: 1800, taxKind: 'labour' }] });
    expect(o).toMatchObject({ totalCents: 1800, taxCents: 0 });
    expect(o.lines[0]).toMatchObject({ itemId: null, name: 'Patch, rear left tire', note: 'nail' });
  });

  test('the business day is the shop’s own', () => {
    // 11:30pm in Los Angeles on the 24th is already the 25th in UTC.
    expect(businessDate('America/Los_Angeles', new Date('2026-09-25T06:30:00Z'))).toBe('2026-09-24');
  });
});

describe('where the tax comes from', () => {
  test('the shop’s own Stripe Tax once it’s active there', async () => {
    const s = await mikesTire();
    await connectorStore.insert(db, { merchant: s.merchant, provider: 'stripe', externalAccountId: `acct_tax_${s.merchant.slice(-6)}`, connectedBy: s.staff.owner });
    forgetTaxStatus();
    const tax = fakeTax({ shopStatus: 'active' });
    const o = await createOrder(db, { taxApi: tax.api, pinCheck: async () => null }, { merchant: s.merchant, staffId: s.staff.jen, lines: s.ticket });
    expect(o).toMatchObject({ taxSource: 'stripe', taxCents: 5952 });
    expect(tax.calls.at(-1)!.account).toBe(`acct_tax_${s.merchant.slice(-6)}`);
    expect(await taxStatus(db, tax.api, s.merchant)).toMatchObject({ source: 'stripe', stripe: 'active', rates: { goods: '7.75', labour: '0', food: '7.75' } });
  });

  test('no rate known for the address (Stripe isn’t collecting there): no tax, and the order says so', async () => {
    const s = await mikesTire();
    const tax = fakeTax({ collecting: false });
    const o = await createOrder(db, { taxApi: tax.api, pinCheck: async () => null }, { merchant: s.merchant, staffId: s.staff.jen, lines: s.ticket });
    expect(o).toMatchObject({ taxSource: 'none', taxCents: 0, totalCents: 86800 });
    expect(await taxStatus(db, tax.api, s.merchant)).toMatchObject({ source: 'none', stripe: 'not_connected', rates: { goods: null } });
  });

  test('no address yet: no tax', async () => {
    const s = await mikesTire({ address: false });
    const o = await createOrder(db, { taxApi: fakeTax().api, pinCheck: async () => null }, { merchant: s.merchant, staffId: s.staff.jen, lines: s.ticket });
    expect(o.taxSource).toBe('none');
  });

  test('tax included in prices: a $9.00 taco costs $9.00', async () => {
    const s = await mikesTire();
    await updateSettings(db, { merchant: s.merchant, staffId: s.staff.owner, patch: { tax: { pricesIncludeTax: true } } });
    const taco = await catalog.createItem(db, { merchant: s.merchant, staffId: s.staff.owner, item: { name: 'Street tacos, 3', detail: null, category: 'Food', priceCents: 900, costCents: null, taxKind: 'food', stockTracked: false, reorderAt: null } });
    const o = await createOrder(db, { taxApi: fakeTax().api, pinCheck: async () => null }, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: taco.id, quantity: 1, optionIds: [] }] });
    expect(o).toMatchObject({ totalCents: 900, taxCents: 65, subtotalCents: 835, taxIncluded: true });
  });
});

describe('discounts', () => {
  const deps = (pin?: Record<string, { id: string; role: 'counter' | 'manager' | 'owner' }>): OrderDeps => ({ taxApi: fakeTax().api, pinCheck: async (_m, p) => pin?.[p] ?? null });

  test('a code comes off before tax: the reference’s $53.57 on the discounted parts', async () => {
    const s = await mikesTire();
    await catalog.createDiscountCode(db, { merchant: s.merchant, staffId: s.staff.manager, code: { code: 'FALL10', percent: 10, amountCents: null, appliesTo: { all: true }, startsAt: null, endsAt: null, oncePerCustomer: false } });
    const o = await createOrder(db, deps(), { merchant: s.merchant, staffId: s.staff.jen, lines: s.ticket });
    const d = await applyDiscount(db, deps(), { merchant: s.merchant, orderId: o.id, staff: { id: s.staff.jen, role: 'counter' }, request: { kind: 'code', code: 'fall10' } });
    expect(d).toMatchObject({ discountCents: 8680, taxCents: 5357, totalCents: 86800 - 8680 + 5357, discount: { kind: 'code', label: 'FALL10 · 10% off', approvedBy: null } });
    expect(d.lines.map((l) => l.discountCents)).toEqual([7560, 1000, 120]);
  });

  test('a code for some categories comes off only those lines', async () => {
    const s = await mikesTire();
    await catalog.createDiscountCode(db, { merchant: s.merchant, staffId: s.staff.manager, code: { code: 'TIRES20', percent: null, amountCents: 2000, appliesTo: { categories: ['Tires'] }, startsAt: null, endsAt: null, oncePerCustomer: false } });
    const o = await createOrder(db, deps(), { merchant: s.merchant, staffId: s.staff.jen, lines: s.ticket });
    const d = await applyDiscount(db, deps(), { merchant: s.merchant, orderId: o.id, staff: { id: s.staff.jen, role: 'counter' }, request: { kind: 'code', code: 'TIRES20' } });
    expect(d.lines.map((l) => l.discountCents)).toEqual([2000, 0, 0]);
  });

  test('over the counter’s 10%: needs a manager’s or owner’s PIN, not their own', async () => {
    const s = await mikesTire();
    const pins = { '1111': { id: s.staff.manager, role: 'manager' as const }, '2222': { id: s.staff.jen, role: 'counter' as const } };
    const o = await createOrder(db, deps(pins), { merchant: s.merchant, staffId: s.staff.jen, lines: s.ticket });
    const ask = (approverPin: string | null) =>
      applyDiscount(db, deps(pins), { merchant: s.merchant, orderId: o.id, staff: { id: s.staff.jen, role: 'counter' }, request: { kind: 'manual', percent: 15, amountCents: null, reason: 'Returning customer', approverPin } });
    await expect(ask(null)).rejects.toMatchObject({ code: 'needs_approval' });
    await expect(ask('2222')).rejects.toMatchObject({ code: 'approver_invalid' });
    const d = await ask('1111');
    expect(d.discount).toMatchObject({ kind: 'manual', label: '15% · Returning customer', approvedBy: s.staff.manager });
    expect(d.discountCents).toBe(13020);
  });

  test('within the limit needs no PIN; a manager’s 30% needs the owner', async () => {
    const s = await mikesTire();
    const pins = { '9999': { id: s.staff.owner, role: 'owner' as const } };
    const a = await createOrder(db, deps(pins), { merchant: s.merchant, staffId: s.staff.jen, lines: s.ticket });
    expect((await applyDiscount(db, deps(pins), { merchant: s.merchant, orderId: a.id, staff: { id: s.staff.jen, role: 'counter' }, request: { kind: 'manual', percent: 10, amountCents: null, reason: 'Loyal', approverPin: null } })).discount!.approvedBy).toBeNull();
    const b = await createOrder(db, deps(pins), { merchant: s.merchant, staffId: s.staff.manager, lines: [{ itemId: s.stems.id, quantity: 1, optionIds: [] }] });
    await expect(applyDiscount(db, deps(pins), { merchant: s.merchant, orderId: b.id, staff: { id: s.staff.manager, role: 'manager' }, request: { kind: 'manual', percent: 30, amountCents: null, reason: 'Damaged box', approverPin: null } })).rejects.toMatchObject({ code: 'needs_approval' });
    expect((await applyDiscount(db, deps(pins), { merchant: s.merchant, orderId: b.id, staff: { id: s.staff.manager, role: 'manager' }, request: { kind: 'manual', percent: 30, amountCents: null, reason: 'Damaged box', approverPin: '9999' } })).discount!.approvedBy).toBe(s.staff.owner);
  });

  test('one per order; removing it puts the figures back', async () => {
    const s = await mikesTire();
    const o = await createOrder(db, deps(), { merchant: s.merchant, staffId: s.staff.owner, lines: s.ticket });
    await applyDiscount(db, deps(), { merchant: s.merchant, orderId: o.id, staff: { id: s.staff.owner, role: 'owner' }, request: { kind: 'manual', percent: null, amountCents: 5000, reason: 'Goodwill', approverPin: null } });
    await expect(applyDiscount(db, deps(), { merchant: s.merchant, orderId: o.id, staff: { id: s.staff.owner, role: 'owner' }, request: { kind: 'manual', percent: 5, amountCents: null, reason: 'x', approverPin: null } })).rejects.toMatchObject({ code: 'one_discount' });
    const back = await removeDiscount(db, deps(), { merchant: s.merchant, orderId: o.id, staffId: s.staff.owner });
    expect(back).toMatchObject({ discountCents: 0, taxCents: 5952, totalCents: 92752, discount: null });
  });

  test('once per customer; an unknown or finished code is said plainly', async () => {
    const s = await mikesTire();
    await catalog.createDiscountCode(db, { merchant: s.merchant, staffId: s.staff.manager, code: { code: 'WELCOME', percent: 5, amountCents: null, appliesTo: { all: true }, startsAt: null, endsAt: null, oncePerCustomer: true } });
    await catalog.createDiscountCode(db, { merchant: s.merchant, staffId: s.staff.manager, code: { code: 'SUMMER', percent: 5, amountCents: null, appliesTo: { all: true }, startsAt: '2026-06-01T00:00:00Z', endsAt: '2026-09-01T00:00:00Z', oncePerCustomer: false } });
    const o = await createOrder(db, deps(), { merchant: s.merchant, staffId: s.staff.jen, lines: s.ticket, customer: 'Ray C.' });
    const code = (c: string, orderId = o.id) => applyDiscount(db, deps(), { merchant: s.merchant, orderId, staff: { id: s.staff.jen, role: 'counter' }, request: { kind: 'code', code: c } });
    await expect(code('NOPE')).rejects.toMatchObject({ code: 'code_unknown' });
    await expect(code('SUMMER')).rejects.toMatchObject({ code: 'code_not_live' });
    await code('WELCOME');
    // Ray pays for this one…
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO payments.drawer_sessions (id, merchant, business_date, opened_by, starting_cash_cents) VALUES ($1, $2, '2026-09-24', $3, 15000)`,
        [`drw_${o.id}`, s.merchant, s.staff.jen],
      );
      const total = (await tx.query<{ total_cents: string }>('SELECT total_cents FROM commerce.orders WHERE id = $1', [o.id])).rows[0]!.total_cents;
      await tx.query(
        `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, status, idempotency_key, request_hash, created_by, drawer_session_id, handed_over_cents, change_cents) VALUES ($1,$2,$3,'cash',$4,'approved',$5,'h',$6,$7,$4,0)`,
        [`tnd_${o.id}`, s.merchant, o.id, total, `k_${o.id}`, s.staff.jen, `drw_${o.id}`],
      );
      await settleOrder(tx, { merchant: s.merchant, orderId: o.id, actor: s.staff.jen });
    });
    // …so the next time, WELCOME is used up.
    const again = await createOrder(db, deps(), { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: s.stems.id, quantity: 1, optionIds: [] }], customer: 'ray c.' });
    await expect(code('WELCOME', again.id)).rejects.toMatchObject({ code: 'code_used' });
  });
});

describe('changing an order, and its stock as it’s paid', () => {
  const deps: OrderDeps = { taxApi: fakeTax().api, pinCheck: async () => null };

  test('new lines while open: holds move with them; once payment starts it’s locked', async () => {
    const s = await mikesTire();
    const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: s.ticket });
    const changed = await updateOrder(db, deps, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, lines: [{ itemId: s.tire.id, quantity: 2, optionIds: [] }] });
    expect(changed).toMatchObject({ subtotalCents: 37800, taxCents: 2930 });
    expect(await level(s.tire.id)).toEqual({ on_hand: 8, held: 2, free: 6 });
    // An order can keep its own stock when it changes: all 8 when the other 6 are free.
    await updateOrder(db, deps, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, lines: [{ itemId: s.tire.id, quantity: 8, optionIds: [] }] });
    expect(await level(s.tire.id)).toEqual({ on_hand: 8, held: 8, free: 0 });
    await db.query(
      `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, idempotency_key, request_hash, created_by) VALUES ($1,$2,$3,'card',100,$4,'h',$5)`,
      [`tnd_lock_${o.id}`, s.merchant, o.id, `k_lock_${o.id}`, s.staff.jen],
    );
    await expect(updateOrder(db, deps, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, lines: s.ticket })).rejects.toMatchObject({ code: 'locked' });
  });

  test('paid: the hold becomes a sale; voided before that: released; paid then unpaid: held again', async () => {
    const s = await mikesTire();
    const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: s.tire.id, quantity: 4, optionIds: [] }] });
    const order = await getOrder(db, s.merchant, o.id);
    await db.query(`INSERT INTO payments.drawer_sessions (id, merchant, business_date, opened_by, starting_cash_cents) VALUES ($1, $2, '2026-09-24', $3, 0)`, [`drw_p_${o.id}`, s.merchant, s.staff.jen]);
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, status, idempotency_key, request_hash, created_by, drawer_session_id, handed_over_cents, change_cents) VALUES ($1,$2,$3,'cash',$4,'approved',$5,'h',$6,$7,$4,0)`,
        [`tnd_p_${o.id}`, s.merchant, o.id, order.totalCents, `k_p_${o.id}`, s.staff.jen, `drw_p_${o.id}`],
      );
      await settleOrder(tx, { merchant: s.merchant, orderId: o.id, actor: s.staff.jen });
    });
    expect(await level(s.tire.id)).toEqual({ on_hand: 4, held: 0, free: 4 });
    const { rows: outbox } = await db.query<{ topic: string }>(`SELECT topic FROM payments.outbox WHERE payload->>'orderId' = $1`, [o.id]);
    expect(outbox.map((r) => r.topic)).toEqual(['order.paid']);
    // The cash goes back (a void, in 6c): the order is open again and the tires are held again.
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE payments.tenders SET status = 'cancelled' WHERE id = $1`, [`tnd_p_${o.id}`]);
      await settleOrder(tx, { merchant: s.merchant, orderId: o.id, actor: s.staff.manager });
    });
    expect(await level(s.tire.id)).toEqual({ on_hand: 8, held: 4, free: 4 });
    // Voided outright: released.
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE commerce.orders SET status = 'voided', voided_at = now(), voided_by = $2 WHERE id = $1`, [o.id, s.staff.manager]);
      await settleOrder(tx, { merchant: s.merchant, orderId: o.id, actor: s.staff.manager });
    });
    expect(await level(s.tire.id)).toEqual({ on_hand: 8, held: 0, free: 8 });
  });
});

describe('the discount split', () => {
  test('in proportion, pennies to the largest remainders, never more than asked', () => {
    expect(allocate([75600, 10000, 1200], 8680)).toEqual([7560, 1000, 120]);
    expect(allocate([100, 100, 100], 100)).toEqual([34, 33, 33]);
    expect(allocate([500, 0], 100)).toEqual([100, 0]);
    expect(allocate([0, 0], 100)).toEqual([0, 0]);
  });
});
