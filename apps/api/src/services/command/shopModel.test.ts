import { PGlite } from '@electric-sql/pglite';
import { describe, expect, test } from 'bun:test';
import { loadMigrations, migrate } from '../../db/migrate.js';
import { LAZY_MERCHANT_TABLES, pgliteDb, testDb } from '../../db/testDb.js';
import { averageAfter, costRecipe, extraFor, flatFor, inputType, lastPaidOf, productCost, readBook, readHistory, type Book, type Input, type Line, type Override } from './costing.js';
import { breakFor, cardFee, costOverheads, orderSupplies, reorderFor } from './shopModel.js';

/*
 * The redesign's Shop data model: the average cost and the last price paid, extras by size or colour,
 * a flat cost with its colours' and sizes' own, what an order costs once, and when to reorder. Then the
 * migrations: what was recorded before them still reads the same.
 */

const input = (id: string, unitCostCents: number | null, o: Partial<Input> = {}): Input => ({
  id,
  name: id,
  kind: 'material',
  unit: 'each',
  stocked: false,
  unitCostCents,
  lowMark: null,
  note: '',
  archived: false,
  lastPurchase: null,
  ...o,
});
const line = (inputId: string, amount: number | null, costCents: number | null = null): Line => ({ productId: 'p', inputId, position: 0, amount, costCents });
const book = (inputs: Input[], o: Partial<Book> = {}): Book => ({
  inputs: new Map(inputs.map((i) => [i.id, i])),
  products: new Map(),
  lines: new Map(),
  overrides: new Map(),
  variants: new Map(),
  onHand: new Map(),
  ...o,
});

describe('the average cost and the last price paid', () => {
  test('a buy received: on hand at the old average plus what was paid, over the new total', () => {
    // 46 on hand at $10.18, then 72 for $748.80 ($10.40 each)
    expect(averageAfter(46, 1018, 72, 74880)).toBeCloseTo((46 * 1018 + 74880) / 118, 9);
    // 24 at $10.20, then 72 at $10.40: $10.35
    expect(averageAfter(24, 1020, 72, 74880)).toBe(1035);
  });

  test('with nothing on hand, or less after a run made short, or no average yet, it’s the price paid', () => {
    expect(averageAfter(0, 1018, 120, 305520)).toBe(2546);
    expect(averageAfter(-4, 1018, 10, 10000)).toBe(1000);
    expect(averageAfter(20, null, 10, 10000)).toBe(1000);
  });

  test('the last price paid is kept apart: as stored, else from the latest purchase', () => {
    expect(lastPaidOf({ lastCostCents: 1040, lastPurchase: null })).toBe(1040);
    expect(lastPaidOf({ lastCostCents: null, lastPurchase: { at: 0, quantity: 20, totalCents: 16400, supplier: '' } })).toBe(820);
    expect(lastPaidOf({ lastCostCents: null, lastPurchase: null })).toBeNull();
  });

  test('the three kinds, from what’s stored', () => {
    expect([inputType({ stocked: true }), inputType({ stocked: false }), inputType({ stocked: true, perOrder: true }), inputType({ stocked: false, perOrder: true })]).toEqual([
      'stock',
      'mto',
      'order',
      'order',
    ]);
  });
});

describe('extras by size or colour', () => {
  const blank = input('blank', 1018, {
    stocked: true,
    extras: [
      { option: '', size: 'XXL', cents: 120 },
      { option: 'Cobalt', size: '', cents: 40 },
    ],
  });
  const print = input('print', 580, { extras: [{ option: '', size: 'XXL', cents: 60 }] });
  const inputs = new Map([blank, print].map((i) => [i.id, i]));
  const lines = [line('blank', 1), line('print', 1)];

  test('a size’s and a colour’s extras add up; none for the recipe as written', () => {
    expect(extraFor(blank, { option: 'Cobalt', size: 'XXL' })).toBe(160);
    expect(extraFor(blank, { option: 'Black', size: 'M' })).toBe(0);
    expect(extraFor(blank, null)).toBe(0);
    expect(costRecipe(lines, [], inputs).costCents).toBe(1598);
    expect(costRecipe(lines, [], inputs, { option: 'Black', size: 'M' }).costCents).toBe(1598);
    // XXL Cobalt: +$1.20 +$0.40 on the blank, +$0.60 on the print
    const c = costRecipe(lines, [], inputs, { option: 'Cobalt', size: 'XXL' });
    expect(c.costCents).toBe(1598 + 220);
    expect(c.lines.map((l) => l.extraCents ?? 0)).toEqual([160, 60]);
  });

  test('extras are per unit used: two blanks, twice the extra', () => {
    expect(costRecipe([line('blank', 2)], [], inputs, { option: 'Black', size: 'XXL' }).costCents).toBe(2 * (1018 + 120));
  });

  test('a product’s own override of the line wins over the extras', () => {
    const o: Override = { productId: 'p', inputId: 'blank', option: '', size: 'XXL', amount: null, costCents: 1300 };
    const c = costRecipe(lines, [o], inputs, { option: 'Cobalt', size: 'XXL' });
    // the blank is the override's $13.00, nothing added; the print still gets its XXL extra
    expect(c.lines.map((l) => [l.costCents, l.override])).toEqual([
      [1300, true],
      [640, false],
    ]);
  });

  test('a line with no amount yet has no units to add an extra to', () => {
    const c = costRecipe([line('dye', null, 120)], [], new Map([['dye', input('dye', null, { extras: [{ option: '', size: 'XXL', cents: 10 }] })]]), { option: '', size: 'XXL' });
    expect(c.costCents).toBe(120);
  });
});

describe('a flat cost, with its colours’ and sizes’ own', () => {
  const list = [
    { option: 'Cobalt', size: '', costCents: 1900 },
    { option: '', size: 'XXL', costCents: 2000 },
    { option: 'Cobalt', size: 'XXL', costCents: 2150 },
  ];
  test('the most specific wins: colour and size, then size, then colour, then the flat cost', () => {
    expect(flatFor(1820, list, { option: 'Cobalt', size: 'XXL' })).toBe(2150);
    expect(flatFor(1820, list, { option: 'Black', size: 'XXL' })).toBe(2000);
    expect(flatFor(1820, list, { option: 'Cobalt', size: 'M' })).toBe(1900);
    expect(flatFor(1820, list, { option: 'White', size: 'M' })).toBe(1820);
    expect(flatFor(1820, list, null)).toBe(1820);
  });

  test('set, it’s the product’s cost over its recipe and its boxes; cleared, they come back', () => {
    const b = book([input('blank', 1000)], {
      products: new Map([['gdv', { id: 'gdv', priceCents: 4400, boxes: [1000, 500, 100, 100], deposit: false, flatCents: 1820 }]]),
      lines: new Map([['gdv', [line('blank', 1)]]]),
      flatOverrides: new Map([['gdv', list]]),
    });
    expect(productCost(b, 'gdv')).toEqual({ costCents: 1820, lines: [], source: 'flat' });
    expect(productCost(b, 'gdv', { option: 'Cobalt', size: 'M' }).costCents).toBe(1900);
    b.products.get('gdv')!.flatCents = null;
    expect(productCost(b, 'gdv')).toMatchObject({ costCents: 1000, source: 'recipe' });
    b.lines.delete('gdv');
    expect(productCost(b, 'gdv')).toMatchObject({ costCents: 1700, source: 'boxes' });
  });
});

describe('what an order costs once', () => {
  const b = book([
    input('mail', 42, { stocked: true, perOrder: true }),
    input('tis', 18, { stocked: true, perOrder: true, onPickup: true }),
    input('thl', 4, { perOrder: true }),
    input('old', 99, { perOrder: true, archived: true }),
    input('blank', 1000, { stocked: true }),
  ]);
  test('shipped, every once-per-order input; picked up, only those marked for pickups', () => {
    expect(orderSupplies(b, 'ship')).toEqual([
      ['mail', 42],
      ['tis', 18],
      ['thl', 4],
    ]);
    expect(orderSupplies(b, 'pickup')).toEqual([['tis', 18]]);
  });

  test('the card fee: 2.9% + 30¢, none on an order paid with Clear or on nothing', () => {
    expect(cardFee(4600, 'card')).toBe(Math.round(4600 * 0.029 + 30));
    expect(cardFee(10000, 'wallet')).toBe(320);
    expect(cardFee(10000, 'clear')).toBe(0);
    expect(cardFee(0, 'card')).toBe(0);
  });
});

describe('when to reorder', () => {
  const blank = { id: 'blank', lowMark: null, lastCostCents: 1040, lastPurchase: null, unitCostCents: 1018 };
  const base = {
    onHand: 46,
    onOrder: 0,
    used: 16,
    leadDays: 7,
    bufferWeeks: 1,
    breaks: [
      [24, 0],
      [72, 0.04],
      [144, 0.08],
    ] as Array<[number, number]>,
    supplier: 'wcb',
    now: 0,
  };

  test('the best break a quantity reaches', () => {
    expect([breakFor(base.breaks, 10), breakFor(base.breaks, 24), breakFor(base.breaks, 100), breakFor(base.breaks, 144)]).toEqual([0, 0, 0.04, 0.08]);
  });

  test('lasting longer than the lead time plus the buffer, it isn’t due', () => {
    // 16 used in four weeks is 4 a week: 46 last 11.5 weeks; the wait is 1 + 1
    const r = reorderFor(blank, base);
    expect([r.perWeek, r.lastsWeeks, r.needWeeks, r.due, r.suggest]).toEqual([4, 11.5, 2, false, null]);
  });

  test('lasting less, it’s due: enough for the wait and four weeks after, at the last price less its break', () => {
    const r = reorderFor(blank, { ...base, onHand: 6, used: 40, now: 1000 });
    // 10 a week: 6 last 0.6 weeks, under 2. 10 × (2 + 4) − 6 = 54, over the first break of 24
    expect([r.lastsWeeks, r.due]).toEqual([0.6, true]);
    expect(r.suggest).toEqual({ quantity: 54, supplier: 'wcb', unitCostCents: 1040, discount: 0, totalCents: 54 * 1040, landsAt: 1000 + 7 * 864e5 });
    // a busier month reaches the 72 break
    const big = reorderFor(blank, { ...base, onHand: 6, used: 60 });
    expect(big.suggest).toMatchObject({ quantity: 84, discount: 0.04, totalCents: Math.round(84 * 1040 * 0.96) });
  });

  test('at least the supplier’s first break, and what’s on order counts', () => {
    expect(reorderFor(blank, { ...base, onHand: 1, used: 4 }).suggest!.quantity).toBe(24);
    // 72 on the way: it lasts, so nothing to order
    expect(reorderFor(blank, { ...base, onHand: 1, onOrder: 72, used: 40 }).due).toBe(false);
  });

  test('nothing used: due only at its reorder mark, for twice the mark', () => {
    const marked = { ...blank, lowMark: 50 };
    const r = reorderFor(marked, { ...base, onHand: 40, used: 0, breaks: [] });
    expect([r.lastsWeeks, r.low, r.due, r.suggest!.quantity]).toEqual([null, true, true, 60]);
    expect(reorderFor(blank, { ...base, used: 0 }).due).toBe(false);
    // no supplier: no lead time, and no landing date
    expect(reorderFor(marked, { ...base, onHand: 40, used: 0, leadDays: null, supplier: null }).suggest).toMatchObject({ supplier: null, landsAt: null });
  });
});

describe('recorded once per order (PGlite)', () => {
  test('each live order without a record gets its packing, shipping charged and card fee, once', async () => {
    const { db } = await testDb();
    await db.query(
      `INSERT INTO command.shop_inputs (id, name, kind, unit, stocked, unit_cost_cents, per_order, on_pickup) VALUES ('mail', 'Mailer', 'material', 'each', true, 42, true, false), ('tis', 'Tissue', 'material', 'each', true, 18, true, true)`,
    );
    await db.query(
      `INSERT INTO command.shop_orders (id, paid_at, buyer, member, items, paid_with, fulfilment, pickup_at, state, city, source, stripe_session, total_cents, shipping_cents) VALUES
         ('2001', now(), 'A B.', false, '[]', 'card', 'ship', '', 'paid', '', 'stripe', 's1', 5200, NULL),
         ('2002', now(), 'C D.', false, '[]', 'card', 'ship', '', 'paid', '', 'stripe', 's2', 5900, 700),
         ('2003', now(), 'E F.', false, '[]', 'card', 'pickup', 'Mesa', 'paid', '', 'stripe', 's3', 4600, NULL)`,
    );
    expect(await costOverheads(db, await readBook(db))).toBe(3);
    expect(await costOverheads(db, await readBook(db))).toBe(0);
    const { rows } = await db.query<any>('SELECT order_id, supplies, supplies_cents, charged_cents, label_cents, fee_cents FROM command.shop_order_overheads ORDER BY order_id');
    expect(rows).toEqual([
      // Settings' flat $6 stands in when the checkout doesn't say
      {
        order_id: '2001',
        supplies: [
          ['mail', 42],
          ['tis', 18],
        ],
        supplies_cents: 60,
        charged_cents: 600,
        label_cents: null,
        fee_cents: Math.round(5200 * 0.029 + 30),
      },
      {
        order_id: '2002',
        supplies: [
          ['mail', 42],
          ['tis', 18],
        ],
        supplies_cents: 60,
        charged_cents: 700,
        label_cents: null,
        fee_cents: Math.round(5900 * 0.029 + 30),
      },
      // picked up: tissue only, no shipping
      { order_id: '2003', supplies: [['tis', 18]], supplies_cents: 18, charged_cents: 0, label_cents: null, fee_cents: Math.round(4600 * 0.029 + 30) },
    ]);
  });
});

describe('the migrations keep what was recorded before them', () => {
  test('purchases read as received, the last price is the newest’s, runs are done, and no cost moves', async () => {
    const pg = new PGlite();
    await pg.exec(LAZY_MERCHANT_TABLES);
    const db = pgliteDb(pg);
    const all = await loadMigrations();
    await migrate(
      db,
      all.filter((m) => m.version < '0060'),
    );
    await db.query(
      `INSERT INTO command.shop_inputs (id, name, kind, unit, stocked, unit_cost_cents) VALUES ('blank', 'Blank', 'material', 'each', true, 820), ('emb', 'Embroidery', 'service', 'each', false, 300)`,
    );
    await db.query(
      `INSERT INTO command.shop_input_purchases (input_id, at, quantity, total_cents, supplier) VALUES ('blank', '2026-09-01', 10, 10000, 'Old'), ('blank', '2026-10-01', 20, 16400, 'Blanks Co'), ('emb', '2026-10-02', 10, 3000, '')`,
    );
    await db.query(`INSERT INTO command.shop_input_moves (input_id, at, quantity, reason, ref) VALUES ('blank', '2026-09-01', 10, 'purchase', 1), ('blank', '2026-10-01', 20, 'purchase', 2)`);
    await db.query(
      `INSERT INTO command.shop_products (id, position, name, variant, line, glyph, price_cents, cost_cents, status, options, slug) VALUES ('lts', 0, 'Logo Tee', 'Short', 'logo', 'tee', 4600, '{1000,500,100,100}', 'on', '{Black}', 'lts')`,
    );
    await db.query(`INSERT INTO command.shop_stock (product_id, option, option_pos, size, size_pos, on_hand) VALUES ('lts', 'Black', 0, 'M', 0, 0)`);
    await db.query(`INSERT INTO command.shop_runs (product_id, option, size, units, at) VALUES ('lts', 'Black', 'M', 4, '2026-10-05')`);

    expect(await migrate(db, all)).toEqual(all.filter((m) => m.version >= '0060').map((m) => m.version));
    const after = await readBook(db);
    // the cost the engine uses is what it was: the average starts there
    expect([after.inputs.get('blank')!.unitCostCents, after.inputs.get('emb')!.unitCostCents]).toEqual([820, 300]);
    expect([after.inputs.get('blank')!.lastCostCents, after.inputs.get('emb')!.lastCostCents]).toEqual([820, 300]);
    expect(after.inputs.get('blank')!.lastPurchase).toEqual({ at: Date.parse('2026-10-01T00:00:00Z'), quantity: 20, totalCents: 16400, supplier: 'Blanks Co' });
    expect(productCost(after, 'lts')).toEqual({ costCents: 1700, lines: [], source: 'boxes' });
    const { rows } = await db.query<any>(`SELECT state, received_at IS NOT NULL AS received FROM command.shop_input_purchases ORDER BY id`);
    expect(rows).toEqual(Array(3).fill({ state: 'received', received: true }));
    const h = await readHistory(db);
    expect(h.purchases.get('blank')!.map((p) => p.totalCents)).toEqual([16400, 10000]);
    expect(h.runs.map((r) => [r.units, r.state, r.unitCostCents, r.batch])).toEqual([[4, 'done', null, null]]);
  });
});
