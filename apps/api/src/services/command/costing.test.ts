import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import {
  canMake,
  costRecipe,
  margin,
  onHandFrom,
  orderLineCost,
  productCost,
  purchaseUnitCost,
  readBook,
  roundCents,
  runUses,
  shown,
  unitCostOf,
  workLine,
  type Input,
  type Line,
  type Override,
} from './costing.js';
import { SEE, TOTALS } from './levels.js';
import { shopSection } from './sections.js';
import { seedCommand } from './seed.js';

/*
 * Phase 10a: what goes into a product. The engine both ways (an amount gives a cost, a cost gives
 * an amount), unit costs from purchases, fractions of a cent kept until shown, per-size overrides,
 * the four boxes when there's no recipe, and the Shop payload that carries it.
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
const over = (inputId: string, option: string, size: string, amount: number | null, costCents: number | null = null): Override => ({ productId: 'p', inputId, option, size, amount, costCents });

describe('a line, either way', () => {
  test('an amount gives its cost: 1 blank at $8.20, a quarter hour at $20', () => {
    expect(workLine({ amount: 1, costCents: null }, 820)).toEqual({ amount: 1, costCents: 820, entered: 'amount' });
    expect(workLine({ amount: 0.25, costCents: null }, 2000).costCents).toBe(500);
  });

  test('a cost gives its amount: $5.20 of embroidery at $2.60 a piece is 2', () => {
    expect(workLine({ amount: null, costCents: 520 }, 260)).toEqual({ amount: 2, costCents: 520, entered: 'cost' });
  });

  test('both typed: the amount wins and the cost is worked out', () => {
    expect(workLine({ amount: 3, costCents: 999 }, 100)).toEqual({ amount: 3, costCents: 300, entered: 'amount' });
  });

  test('a zero unit cost can’t give an amount, and says so; an amount at zero costs nothing', () => {
    const w = workLine({ amount: null, costCents: 520 }, 0);
    expect([w.amount, w.costCents, w.entered]).toEqual([null, 520, 'cost']);
    expect(w.note).toContain('can’t be worked out');
    expect(workLine({ amount: null, costCents: 520 }, null).amount).toBeNull();
    expect(workLine({ amount: 2, costCents: null }, 0).costCents).toBe(0);
    expect(workLine({ amount: 2, costCents: null }, null).note).toBe('No unit cost yet');
  });
});

describe('unit costs', () => {
  test('from a purchase: $164 for 20 blanks is $8.20 each', () => {
    expect(purchaseUnitCost(16400, 20)).toBe(820);
    const lastPurchase = { at: 0, quantity: 20, totalCents: 16400, supplier: '' };
    expect(unitCostOf({ unitCostCents: null, lastPurchase })).toBe(820);
    // a cost set straight is the one used
    expect(unitCostOf({ unitCostCents: 900, lastPurchase })).toBe(900);
    expect(unitCostOf({ unitCostCents: null, lastPurchase: null })).toBeNull();
  });

  test('fractions of a cent are kept until shown: 12 ml at $0.0425/ml is 51¢, 1 ml is 4.25¢', () => {
    const inputs = new Map([['ink', input('ink', 4.25)]]);
    expect(costRecipe([line('ink', 12)], [], inputs).costCents).toBeCloseTo(51, 9);
    const one = costRecipe([line('ink', 1)], [], inputs);
    expect(one.costCents).toBe(4.25);
    expect(shown(one.costCents)).toBe(0.04);
    // three 4.25¢ lines are 12.75¢, so 13¢ shown, where rounding each first would give 12¢
    const three = costRecipe([line('ink', 1), line('ink2', 1), line('ink3', 1)], [], new Map(['ink', 'ink2', 'ink3'].map((k) => [k, input(k, 4.25)])));
    expect([three.costCents, roundCents(three.costCents)]).toEqual([12.75, 13]);
  });
});

describe('a product’s cost', () => {
  const inputs = new Map([
    ['blank', input('blank', 820)],
    ['blank-xxl', input('blank-xxl', 980)],
    ['thread', input('thread', 5, { unit: 'm' })],
    ['labour', input('labour', 2000, { kind: 'labour', unit: 'h' })],
  ]);
  const lines = [line('blank', 1), line('thread', 12), line('labour', 0.25)];

  test('the sum of its lines, with a breakdown by input', () => {
    const c = costRecipe(lines, [], inputs);
    expect(c.costCents).toBe(820 + 60 + 500);
    expect(c.lines.map((l) => [l.inputId, l.costCents, l.override])).toEqual([
      ['blank', 820, false],
      ['thread', 60, false],
      ['labour', 500, false],
    ]);
  });

  test('a size’s override applies to that size only, and the most specific one wins', () => {
    const ov = [over('blank', '', 'XXL', null, 980), over('thread', 'Cobalt', '', 20), over('thread', 'Cobalt', 'XXL', 30)];
    expect(costRecipe(lines, ov, inputs, { option: 'Black', size: 'M' }).costCents).toBe(1380);
    expect(costRecipe(lines, ov, inputs, { option: 'Black', size: 'XXL' }).costCents).toBe(980 + 60 + 500);
    // colour alone, then colour and size over size alone
    expect(costRecipe(lines, ov, inputs, { option: 'Cobalt', size: 'M' }).costCents).toBe(820 + 100 + 500);
    const both = costRecipe(lines, ov, inputs, { option: 'Cobalt', size: 'XXL' });
    expect(both.costCents).toBe(980 + 150 + 500);
    expect(both.lines.map((l) => l.override)).toEqual([true, true, false]);
  });

  test('with no recipe, the four boxes; a deposit has neither', () => {
    const book = {
      inputs,
      products: new Map([
        ['tee', { id: 'tee', priceCents: 4600, boxes: [980, 460, 120, 110], deposit: false }],
        ['pt', { id: 'pt', priceCents: 6000, boxes: null, deposit: true }],
      ]),
      lines: new Map(),
      overrides: new Map(),
      variants: new Map(),
      onHand: new Map(),
    };
    expect(productCost(book, 'tee')).toMatchObject({ costCents: 1670, source: 'boxes' });
    expect(productCost(book, 'pt')).toMatchObject({ costCents: 0, source: 'none' });
    book.lines.set('tee', [line('blank', 1)]);
    expect(productCost(book, 'tee')).toMatchObject({ costCents: 820, source: 'recipe' });
  });

  test('margin: price less cost, and its share of the price', () => {
    expect(margin(4600, 1670)).toEqual({ cents: 2930, share: 2930 / 4600 });
    expect(margin(0, 100).share).toBeNull();
  });
});

describe('stock', () => {
  const inputs = new Map([
    ['blank', input('blank', 820, { stocked: true })],
    ['thread', input('thread', 5, { stocked: true, unit: 'm' })],
    ['labour', input('labour', 2000, { kind: 'labour', unit: 'h' })],
  ]);
  const c = costRecipe([line('blank', 1), line('thread', 0.1), line('labour', 0.25)], [], inputs);

  test('on hand is the sum of the moves', () => {
    const on = onHandFrom([
      { inputId: 'blank', quantity: 20 },
      { inputId: 'blank', quantity: -3 },
      { inputId: 'thread', quantity: 0.3 },
    ]);
    expect([on.get('blank'), on.get('thread')]).toEqual([17, 0.3]);
  });

  test('how many it would make, and the input that runs out first', () => {
    // 0.3 m ÷ 0.1 m is 3, though the floats say 2.999…
    expect(
      canMake(
        c,
        inputs,
        new Map([
          ['blank', 17],
          ['thread', 0.3],
        ]),
      ),
    ).toEqual({ units: 3, binding: 'thread', unknown: [] });
    expect(
      canMake(
        c,
        inputs,
        new Map([
          ['blank', 2],
          ['thread', 50],
        ]),
      ),
    ).toMatchObject({ units: 2, binding: 'blank' });
    // labour isn't stock: a recipe of only made-to-order inputs isn't limited
    expect(canMake(costRecipe([line('labour', 1)], [], inputs), inputs, new Map()).units).toBeNull();
  });

  test('what a run uses, stocked inputs only', () => {
    expect(runUses(c, inputs, 12).uses.map((u) => [u.inputId, +u.quantity.toFixed(6)])).toEqual([
      ['blank', 12],
      ['thread', 1.2],
    ]);
    const cost = costRecipe([line('blank', null, 500)], [], new Map([['blank', input('blank', 0, { stocked: true })]]));
    expect(runUses(cost, new Map([['blank', input('blank', 0, { stocked: true })]]), 1).unknown).toEqual(['blank']);
  });
});

// ── against the database ──────────────────────────────────────────────────

let db: Db;
const envShop = process.env.PROVIDER_SHOP;
const at = (level: number) => ({ level: level as 2, reveal: false, now: new Date('2026-10-24T17:00:00Z') });
beforeAll(async () => {
  ({ db } = await testDb());
  await seedCommand(db);
  // a recipe for the short-sleeve Logo Tee (lts: $46, boxes $16.70): a bought blank, thread, ink by
  // the ml, a label by cost, and a quarter hour of labour; its XXL takes a bigger blank
  await db.query(`INSERT INTO command.shop_inputs (id, name, kind, unit, stocked, unit_cost_cents, low_mark) VALUES
    ('blank', 'Blank tee', 'material', 'each', true, NULL, 10),
    ('thread', 'Thread', 'material', 'm', true, 5, NULL),
    ('ink', 'Ink', 'material', 'ml', false, 4.25, NULL),
    ('label', 'Woven label', 'service', 'each', false, 60, NULL),
    ('labour', 'Labour', 'labour', 'h', false, 2000, NULL)`);
  await db.query(`INSERT INTO command.shop_input_purchases (input_id, at, quantity, total_cents) VALUES ('blank', '2026-10-01', 20, 16400)`);
  await db.query(`INSERT INTO command.shop_input_moves (input_id, at, quantity, reason, ref) VALUES ('blank', '2026-10-01', 20, 'purchase', 1), ('thread', '2026-10-01', 200, 'purchase', 1)`);
  await db.query(`INSERT INTO command.shop_input_moves (input_id, at, quantity, reason) VALUES ('blank', '2026-10-02', -12, 'adjust')`);
  await db.query(`INSERT INTO command.shop_recipe_lines (product_id, input_id, position, amount, cost_cents) VALUES
    ('lts', 'blank', 0, 1, NULL), ('lts', 'thread', 1, 12, NULL), ('lts', 'ink', 2, 12, NULL), ('lts', 'label', 3, NULL, 60), ('lts', 'labour', 4, 0.25, NULL)`);
  await db.query(`INSERT INTO command.shop_recipe_overrides (product_id, input_id, option, size, amount, cost_cents) VALUES ('lts', 'blank', '', 'XXL', NULL, 980)`);
});
afterAll(() => {
  if (envShop == null) delete process.env.PROVIDER_SHOP;
  else process.env.PROVIDER_SHOP = envShop;
});

// 820 blank + 60 thread + 51 ink + 60 label + 500 labour
const LTS = 1491;

describe('the book and an order line’s cost', () => {
  test('reads the unit cost from the latest purchase, and on hand from the moves', async () => {
    const book = await readBook(db);
    expect(unitCostOf(book.inputs.get('blank')!)).toBe(820);
    expect(book.onHand.get('blank')).toBe(8);
    expect(productCost(book, 'lts').costCents).toBe(LTS);
  });

  test('a line’s cost at sale, in whole cents, with its size’s override; the boxes without a recipe', async () => {
    expect(await orderLineCost(db, 'lts', 'Black', 'M')).toEqual({ unitCostCents: LTS, source: 'recipe' });
    expect(await orderLineCost(db, 'lts', 'Black', 'XXL')).toEqual({ unitCostCents: LTS + 160, source: 'recipe' });
    expect(await orderLineCost(db, 'ltl', 'Black', 'M')).toEqual({ unitCostCents: 1190 + 460 + 120 + 110, source: 'boxes' });
  });
});

describe('the Shop payload', () => {
  test('seed: a product with a recipe gives the page its cost; one without keeps its four boxes', async () => {
    delete process.env.PROVIDER_SHOP;
    const d: any = await shopSection(db, at(SEE));
    const lts = d.PR.find((p: any) => p.id === 'lts');
    expect(lts.c).toEqual([LTS / 100, 0, 0, 0]);
    // the page's unitCost() sums c
    expect(lts.c.reduce((a: number, b: number) => a + b, 0)).toBe(14.91);
    expect(d.PR.find((p: any) => p.id === 'ltl').c).toEqual([11.9, 4.6, 1.2, 1.1]);
  });

  test('INPUTS: the library with unit costs, on hand, low marks and use', async () => {
    const d: any = await shopSection(db, at(SEE));
    const blank = d.INPUTS.find((i: any) => i.id === 'blank');
    expect(blank).toMatchObject({ name: 'Blank tee', kind: 'material', unit: 'each', stocked: true, unitCost: 8.2, onHand: 8, lowMark: 10, low: true, usedIn: 1, archived: false });
    expect(blank.lastPurchase).toMatchObject({ quantity: 20, total: 164 });
    expect(d.INPUTS.find((i: any) => i.id === 'ink')).toMatchObject({ unitCost: 0.0425, onHand: null, low: false });
  });

  test('RECIPES: lines as entered, overrides, cost and margin per size', async () => {
    const r: any = (await shopSection(db, at(SEE))).RECIPES;
    const lts = r.lts;
    expect(lts.lines.map((l: any) => [l.input, l.amount, l.cost, l.entered])).toEqual([
      ['blank', 1, 8.2, 'amount'],
      ['thread', 12, 0.6, 'amount'],
      ['ink', 12, 0.51, 'amount'],
      ['label', 1, 0.6, 'cost'],
      ['labour', 0.25, 5, 'amount'],
    ]);
    // the XXL's blank, entered as a cost: its amount is worked out from the blank's $8.20
    expect(lts.overrides).toEqual([{ option: '', size: 'XXL', input: 'blank', amount: 980 / 820, cost: 9.8, entered: 'cost' }]);
    expect(lts.cost).toBe(14.91);
    expect(lts.margin).toEqual({ amount: 31.09, share: 3109 / 4600 });
    expect(lts.differs).toBe(true);
    const xxl = lts.variants.find((v: any) => v.option === 'Black' && v.size === 'XXL');
    expect(xxl).toEqual({ option: 'Black', size: 'XXL', cost: 16.51, margin: { amount: 29.49, share: 2949 / 4600 } });
    expect(lts.variants.find((v: any) => v.size === 'M').cost).toBe(14.91);
  });

  test('MATERIALS: what’s on hand, what’s low, and how many it would make', async () => {
    const m: any = (await shopSection(db, at(SEE))).MATERIALS;
    expect(m.onHand.map((x: any) => [x.input, x.onHand, x.low])).toEqual([
      ['blank', 8, true],
      ['thread', 200, false],
    ]);
    expect(m.low).toEqual(['blank']);
    // 8 blanks make 8, 200 m of thread at 12 m a tee 16: the blanks run out first
    expect(m.makes.lts).toEqual({ units: 8, binding: 'blank' });
  });

  test('below See, none of it is sent; the products keep their cost', async () => {
    const d: any = await shopSection(db, at(TOTALS));
    expect([d.INPUTS, d.RECIPES, d.MATERIALS]).toEqual([[], {}, { onHand: [], low: [], makes: {} }]);
    expect(d.PR.find((p: any) => p.id === 'lts').c).toEqual([14.91, 0, 0, 0]);
  });

  test('live: the recipe’s cost reaches the site’s product, and its margin is at the site’s price', async () => {
    process.env.PROVIDER_SHOP = 'live';
    const products = [
      { slug: 'logo-tee', section: 'goods', name: 'Logo Tee', kind: 'tee', category: 'Wear', alsoIn: [], priceCents: 5000, status: 'live', colours: [{ id: 'black', label: 'Black' }], variants: [] },
      {
        slug: 'logo-tee-long',
        section: 'goods',
        name: 'Logo Tee',
        kind: 'tee-ls',
        category: 'Wear',
        alsoIn: [],
        priceCents: 5400,
        status: 'live',
        colours: [{ id: 'black', label: 'Black' }],
        variants: [],
      },
    ];
    await db.query(`UPDATE command.feeds SET figures = $1 WHERE id = 'catalog'`, [JSON.stringify({ products, moved: {} })]);
    const d: any = await shopSection(db, at(SEE));
    const lts = d.PR.find((p: any) => p.id === 'lts');
    expect([lts.price, lts.c, lts.nc]).toEqual([50, [14.91, 0, 0, 0], undefined]);
    expect(d.PR.find((p: any) => p.id === 'ltl').c).toEqual([11.9, 4.6, 1.2, 1.1]);
    expect(d.RECIPES.lts.margin).toEqual({ amount: 35.09, share: 3509 / 5000 });
    expect(d.INPUTS.length).toBe(5);
    expect(d.MATERIALS.low).toEqual(['blank']);
  });
});
