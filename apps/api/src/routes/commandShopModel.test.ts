import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { orderLineCost } from '../services/command/costing.js';
import { SECTIONS, type Levels } from '../services/command/levels.js';
import { seedCommand } from '../services/command/seed.js';
import { commandRouter } from './command.js';

/*
 * The redesign's Shop data model, through the route: suppliers and their breaks, an input's supplier,
 * kind and extras, buys ordered and received (the average and the last price), flat costs, batches,
 * pickup points and an order's own costs. Command's own records at Propose; a buy over Settings'
 * `shopbuy` waits for a second person; at Totals none of it carries a name.
 */

let base = '';
let db: Db;
type Who = { user: string; session?: string };
let kai: Who, dana: Who, look: Who, tot: Who;

const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const signIn = async (user: string): Promise<Who> => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const all = (n: number): Levels => Object.fromEntries(SECTIONS.map((s) => [s, n])) as Levels;
async function person(name: string, levels: Levels) {
  const email = `${name}@useclear.org`;
  await call(kai, 'POST', '/invites', { email, name, group: 'outside' });
  const who = await signIn(`did:${name}|${email}`);
  const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === email).id;
  expect((await call(kai, 'PATCH', `/people/${id}/access`, { custom: levels })).status).toBe(200);
  return who;
}
const q = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T & Record<string, unknown>>(sql, p)).rows as T[];
const act = (who: Who, kind: string, body: unknown) => call(who, 'POST', `/actions/shop/${kind}`, body);
/** Asks as Kai; one that waits is approved by Dana. */
const approved = async (kind: string, body: unknown) => {
  const r = await act(kai, kind, body);
  expect(r.status).toBe(202);
  const a = await call(dana, 'POST', `/proposals/${r.body.proposal.id}/approve`);
  expect(a.status).toBe(200);
  return a.body;
};
const shop = async (who: Who = kai) => (await call(who, 'GET', '/sections/shop')).body;
const inputRow = async (iid: string) => {
  const [r] = await q(`SELECT unit_cost_cents, last_cost_cents FROM command.shop_inputs WHERE id = $1`, [iid]);
  return [Number(r.unit_cost_cents), r.last_cost_cents == null ? null : Number(r.last_cost_cents)];
};
const onHand = async (iid: string) => Number((await q(`SELECT coalesce(sum(quantity), 0) AS n FROM command.shop_input_moves WHERE input_id = $1`, [iid]))[0].n);
const stock = async (pid: string, option: string, size: string) =>
  (await q(`SELECT on_hand FROM command.shop_stock WHERE product_id = $1 AND option = $2 AND size = $3`, [pid, option, size]))[0].on_hand as number;
// the seeded shop's "now": 21 Oct 2026, 14:00
const NOW = Date.UTC(2026, 9, 21, 14);
const DAY = 864e5;

beforeAll(async () => {
  ({ db } = await testDb());
  await seedCommand(db);
  const identify = (req: Request, res: Response, next: NextFunction) => {
    const [id, email] = String(req.header('x-test-user') ?? '').split('|');
    if (!id) return res.status(401).end();
    req.auth = { walletAddress: '', profileUuid: id, email, emails: email ? [email] : [], token: 't' };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/command',
    commandRouter({
      db: async () => db,
      identify,
      isMember: async () => false,
      mail: async () => undefined,
      adminEmails: () => ['kai@useclear.org', 'dana@useclear.org'],
      appUrl: () => 'https://command.test',
      now: () => new Date('2026-10-23T17:00:00Z'),
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/command`;
  kai = await signIn('did:kai|kai@useclear.org');
  dana = await signIn('did:dana|dana@useclear.org');
  look = await person('look', all(2));
  tot = await person('tot', all(1));
});

describe('suppliers', () => {
  test('one is added with its lead time, terms and minimum, then edited by its id', async () => {
    const r = await act(kai, 'supplier', { id: 'wcb', name: 'Westcoast Blanks', city: 'Los Angeles', sells: 'Tees', leadDays: 7, terms: 'Net 15', minimum: '24 per colour' });
    expect(r.body).toMatchObject({ done: true, queued: false, result: { id: 'wcb' } });
    expect(
      (await act(kai, 'supplier', { id: 'wcb', name: 'Westcoast Blanks', city: 'Los Angeles', sells: 'Tees, long sleeves and turtlenecks', leadDays: 7, terms: 'Net 15', minimum: '24 per colour' }))
        .status,
    ).toBe(200);
    const isp = await act(kai, 'supplier', { name: 'Inland Screen Print', city: 'San Bernardino', leadDays: 5 });
    expect(isp.body.result.id).toMatch(/^inland-screen-print-[a-z0-9]+$/);
    expect((await act(kai, 'supplier', { id: 'pac', name: 'Pacific Packaging', leadDays: 4 })).status).toBe(200);
    expect((await act(kai, 'supplier', { name: '' })).status).toBe(400);
    expect((await q(`SELECT action FROM command.audit_log WHERE action = 'Added supplier Westcoast Blanks'`)).length).toBe(1);
  });

  test('price breaks replace the list; one a quantity, under 100% off', async () => {
    expect(
      (
        await act(kai, 'supplier-breaks', {
          supplier: 'wcb',
          breaks: [
            { quantity: 24, discount: 0 },
            { quantity: 72, discount: 0.04 },
            { quantity: 144, discount: 0.08 },
          ],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await act(kai, 'supplier-breaks', {
          supplier: 'wcb',
          breaks: [
            { quantity: 24, discount: 0 },
            { quantity: 24, discount: 0.1 },
          ],
        })
      ).status,
    ).toBe(400);
    expect((await act(kai, 'supplier-breaks', { supplier: 'wcb', breaks: [{ quantity: 24, discount: 1 }] })).status).toBe(400);
    expect((await act(kai, 'supplier-breaks', { supplier: 'nope', breaks: [] })).status).toBe(404);
    const s = (await shop()).SUPPLIERS.find((x: any) => x.id === 'wcb');
    expect(s).toMatchObject({ name: 'Westcoast Blanks', city: 'Los Angeles', sells: 'Tees, long sleeves and turtlenecks', leadDays: 7, terms: 'Net 15', minimum: '24 per colour', lastOrder: null });
    expect(s.breaks).toEqual([
      [24, 0],
      [72, 0.04],
      [144, 0.08],
    ]);
  });
});

describe('the materials: kinds, suppliers and extras', () => {
  test('inputs with their supplier and kind; once per order is set on the input or by its kind', async () => {
    for (const body of [
      { id: 'blank', name: 'Blank tee', kind: 'material', unit: 'tee', stocked: true, lowMark: 10, supplier: 'wcb' },
      { id: 'print', name: 'Screen print', kind: 'service', unit: 'print', unitCost: 4.6 },
      { id: 'mail', name: 'Poly mailer', kind: 'material', unit: 'mailer', stocked: true, perOrder: true, supplier: 'pac' },
      { id: 'tis', name: 'Tissue and sticker', kind: 'material', unit: 'set', stocked: true },
    ])
      expect((await act(kai, 'input', body)).status).toBe(200);
    expect((await act(kai, 'input', { name: 'Glue', kind: 'material', unit: 'g', supplier: 'nope' })).status).toBe(404);
    // tissue becomes once per order, counted on hand and used on pickups too
    expect((await act(kai, 'input-kind', { input: 'tis', kind: 'order', onPickup: true })).status).toBe(200);
    // a service can't be kept on hand
    expect((await act(kai, 'input-kind', { input: 'print', kind: 'stock' })).status).toBe(409);
    const isp = (await q(`SELECT id FROM command.shop_suppliers WHERE name = 'Inland Screen Print'`))[0].id;
    expect((await act(kai, 'input-supplier', { input: 'print', supplier: isp })).status).toBe(200);
    expect((await act(kai, 'input-supplier', { input: 'print', supplier: 'nope' })).status).toBe(404);
    const d = await shop();
    const by = (id: string) => d.INPUTS.find((i: any) => i.id === id);
    expect([by('blank').type, by('print').type, by('mail').type, by('tis').type]).toEqual(['stock', 'mto', 'order', 'order']);
    expect([by('mail').onPickup, by('tis').onPickup, by('tis').stocked]).toEqual([false, true, true]);
    expect([by('blank').supplier, by('print').supplier, by('mail').supplier]).toEqual(['wcb', isp, 'pac']);
    expect(d.SUPPLIERS.find((s: any) => s.id === 'wcb').inputs).toEqual(['blank']);
  });

  test('a once-per-order input isn’t in a product’s recipe', async () => {
    expect((await act(kai, 'recipe-line', { product: 'gcm', input: 'blank', amount: 1 })).status).toBe(200);
    expect((await act(kai, 'recipe-line', { product: 'gcm', input: 'print', amount: 1 })).status).toBe(200);
    const r = await act(kai, 'recipe-line', { product: 'gcm', input: 'mail', amount: 1 });
    expect([r.status, r.body.code]).toEqual([409, 'PER_ORDER']);
    expect((await act(kai, 'input-kind', { input: 'blank', kind: 'order' })).status).toBe(409);
  });

  test('extras by size or colour, one of them a row; removed again', async () => {
    expect((await act(kai, 'input-extra', { input: 'blank', size: 'XXL', extra: 1.2 })).status).toBe(200);
    expect((await act(kai, 'input-extra', { input: 'blank', option: 'Cobalt', extra: 0.4 })).status).toBe(200);
    expect((await act(kai, 'input-extra', { input: 'blank', size: 'XL', option: 'Cobalt', extra: 1 })).status).toBe(400);
    expect((await act(kai, 'input-extra', { input: 'blank', size: 'XL' })).status).toBe(400);
    expect((await act(kai, 'input-extra', { input: 'blank', size: 'XL', remove: true })).status).toBe(404);
    expect((await act(kai, 'input-extra', { input: 'print', size: 'S', extra: 9 })).status).toBe(200);
    expect((await act(kai, 'input-extra', { input: 'print', size: 'S', remove: true })).status).toBe(200);
    const blank = (await shop()).INPUTS.find((i: any) => i.id === 'blank');
    expect(blank.var).toEqual({ XXL: 1.2, Cobalt: 0.4 });
    expect(blank.extras).toEqual([
      { option: 'Cobalt', extra: 0.4 },
      { size: 'XXL', extra: 1.2 },
    ]);
  });
});

describe('buys: recorded, ordered and received', () => {
  test('a buy over the limit waits for a second person, then sets the average and the last price', async () => {
    // $244.80 is over Settings' $50
    const r = await act(kai, 'purchase', { input: 'blank', quantity: 24, total: 244.8 });
    expect([r.status, r.body.needs]).toEqual([202, 'a second person']);
    expect(await onHand('blank')).toBe(0);
    // nobody approves their own
    expect((await call(kai, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(403);
    expect((await call(dana, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(200);
    expect(await onHand('blank')).toBe(24);
    expect(await inputRow('blank')).toEqual([1020, 1020]);
    // the supplier came from the input
    expect((await q(`SELECT supplier, supplier_id FROM command.shop_input_purchases WHERE input_id = 'blank'`))[0]).toEqual({ supplier: 'Westcoast Blanks', supplier_id: 'wcb' });
    // under the limit, it's done straight away
    expect((await act(kai, 'purchase', { input: 'mail', quantity: 100, total: 42 })).status).toBe(200);
    expect((await act(kai, 'purchase', { input: 'tis', quantity: 100, total: 18 })).status).toBe(200);
  });

  test('ordered: neither stock nor the average moves until it’s received, then both do', async () => {
    await approved('order-in', { input: 'blank', quantity: 72, total: 748.8 });
    expect([await onHand('blank'), ...(await inputRow('blank'))]).toEqual([24, 1020, 1020]);
    const d = await shop();
    expect(d.ON_ORDER).toHaveLength(1);
    // due the supplier's lead time on: 7 days from 21 Oct
    expect(d.ON_ORDER[0]).toMatchObject({ input: 'blank', quantity: 72, total: 748.8, unitCost: 10.4, supplier: 'wcb', supplierName: 'Westcoast Blanks', orderedAt: NOW, due: Date.UTC(2026, 9, 28) });
    expect(d.SUPPLIERS.find((s: any) => s.id === 'wcb').lastOrder).toBe(NOW);
    // the order was approved: receiving it doesn't wait again
    const r = await act(kai, 'receive', { id: d.ON_ORDER[0].id });
    expect(r.status).toBe(200);
    // 24 at $10.20 and 72 at $10.40: $10.35 on average, $10.40 last paid
    expect(r.body.result).toMatchObject({ unitCost: 10.4, avg: 10.35 });
    expect([await onHand('blank'), ...(await inputRow('blank'))]).toEqual([96, 1035, 1040]);
    expect((await act(kai, 'receive', { id: d.ON_ORDER[0].id })).status).toBe(409);
    const after = await shop();
    expect(after.ON_ORDER).toEqual([]);
    expect(after.INPUTS.find((i: any) => i.id === 'blank')).toMatchObject({ avg: 10.35, last: 10.4, unitCost: 10.35, onHand: 96 });
  });

  test('a small order goes straight out and can be cancelled; received dearer over the limit, it waits again', async () => {
    const small = await act(kai, 'order-in', { input: 'mail', quantity: 50, total: 21, due: '2026-10-30' });
    expect(small.status).toBe(200);
    expect(small.body.result.due).toBe(Date.UTC(2026, 9, 30));
    expect((await act(kai, 'order-cancel', { id: small.body.result.id })).status).toBe(200);
    expect((await act(kai, 'order-cancel', { id: small.body.result.id })).status).toBe(409);
    const tis = await act(kai, 'order-in', { input: 'tis', quantity: 100, total: 18 });
    expect((await act(kai, 'receive', { id: tis.body.result.id, total: 80 })).status).toBe(202);
    // the same price: no second look
    expect((await act(kai, 'receive', { id: tis.body.result.id, quantity: 100 })).status).toBe(200);
    expect(await onHand('tis')).toBe(200);
  });

  test('a made-to-order input costs its last price', async () => {
    expect((await act(kai, 'purchase', { input: 'print', quantity: 10, total: 46 })).status).toBe(200);
    expect(await inputRow('print')).toEqual([460, 460]);
    const d = await shop();
    expect(d.INPUTS.find((i: any) => i.id === 'print')).toMatchObject({ type: 'mto', avg: 4.6, last: 4.6, onHand: null });
  });
});

describe('product costs: materials with extras, or one flat cost', () => {
  test('extras reach the colours and sizes that have them; a product’s own override wins', async () => {
    // blank $10.35 + print $4.60
    expect((await orderLineCost(db, 'gcm', 'Black', 'M')).unitCostCents).toBe(1495);
    expect((await orderLineCost(db, 'gcm', 'Cobalt', 'XXL')).unitCostCents).toBe(1495 + 160);
    const d = await shop();
    expect(d.RECIPES.gcm.cost).toBe(14.95);
    expect(d.RECIPES.gcm.variants.find((v: any) => v.option === 'Cobalt' && v.size === 'M').cost).toBe(15.35);
    expect(d.RECIPES.gcm.differs).toBe(true);
    expect((await act(kai, 'recipe-override', { product: 'gcm', input: 'blank', size: 'XXL', cost: 12 })).status).toBe(200);
    expect((await orderLineCost(db, 'gcm', 'Cobalt', 'XXL')).unitCostCents).toBe(1200 + 460);
    expect((await act(kai, 'recipe-override', { product: 'gcm', input: 'blank', size: 'XXL', remove: true })).status).toBe(200);
  });

  test('a flat cost wins over the recipe and the boxes, with its estimate, note and colours’ own; cleared, it’s gone', async () => {
    const r = await act(kai, 'flat-cost', { product: 'gdv', cost: 18.2, estimate: true, note: 'Quoted before the sample' });
    expect(r.status).toBe(200);
    expect((await act(kai, 'flat-override', { product: 'gdv', option: 'Cobalt', cost: 19 })).status).toBe(200);
    expect((await act(kai, 'flat-override', { product: 'gdv', option: 'Plaid', cost: 19 })).status).toBe(404);
    expect((await act(kai, 'flat-override', { product: 'lts', size: 'M', cost: 1 })).status).toBe(404);
    expect((await orderLineCost(db, 'gdv', 'Cobalt', 'M')).unitCostCents).toBe(1900);
    expect(await orderLineCost(db, 'gdv', 'Black', 'M')).toEqual({ unitCostCents: 1820, source: 'flat' });
    const d = await shop();
    expect(d.COST_BY).toMatchObject({ gdv: 'flat', gcm: 'recipe', lts: 'boxes' });
    expect(d.FLAT.gdv).toEqual({ cost: 18.2, estimate: true, note: 'Quoted before the sample', margin: { amount: 25.8, share: 2580 / 4400 }, overrides: [{ option: 'Cobalt', size: '', cost: 19 }] });
    expect(d.PR.find((p: any) => p.id === 'gdv').c).toEqual([18.2, 0, 0, 0]);
    expect((await act(kai, 'flat-cost', { product: 'gdv', cost: null })).status).toBe(200);
    const after = await shop();
    expect([after.COST_BY.gdv, after.FLAT.gdv]).toEqual(['boxes', undefined]);
    expect((await q(`SELECT count(*)::int AS n FROM command.shop_flat_overrides WHERE product_id = 'gdv'`))[0].n).toBe(0);
  });
});

describe('batches', () => {
  test('planned: nothing used or added; checked against what’s on hand now; short when it can’t be made', async () => {
    const r = await act(kai, 'batch-plan', {
      product: 'gcm',
      option: 'Black',
      units: [
        { size: 'M', n: 2 },
        { size: 'XXL', n: 3 },
      ],
      on: '2026-10-28',
      note: 'For the market',
    });
    expect(r.status).toBe(200);
    expect(r.body.result.batch).toMatch(/^B-\d{3}$/);
    const big = await act(kai, 'batch-plan', { product: 'gcm', option: 'White', units: [{ size: 'S', n: 200 }] });
    expect((await act(kai, 'batch-plan', { product: 'gcm', option: 'Plaid', units: [{ size: 'S', n: 1 }] })).status).toBe(404);
    expect(await onHand('blank')).toBe(96);
    const d = await shop();
    const b = d.BATCHES.find((x: any) => x.id === r.body.result.batch);
    expect(b).toMatchObject({ product: 'gcm', option: 'Black', state: 'planned', at: Date.UTC(2026, 9, 28), units: 5, estimate: true, note: 'For the market' });
    // M at $14.95, XXL at $16.15
    expect(b.sizes.map((s: any) => [s.size, s.units, s.unitCost])).toEqual([
      ['M', 2, 14.95],
      ['XXL', 3, 16.15],
    ]);
    expect(b.total).toBe(2 * 14.95 + 3 * 16.15);
    expect(b.needs).toEqual([{ input: 'blank', quantity: 5, onHand: 96 }]);
    expect(d.BATCHES.find((x: any) => x.id === big.body.result.batch).state).toBe('short');
    // the planned ones aren't runs yet
    expect(d.RUNS).toEqual([]);
    const short = await act(kai, 'batch-done', { batch: big.body.result.batch });
    expect([short.status, short.body.code]).toEqual([409, 'SHORT']);
    expect((await act(kai, 'batch-cancel', { batch: big.body.result.batch })).status).toBe(200);
    expect((await act(kai, 'batch-cancel', { batch: big.body.result.batch })).status).toBe(404);
  });

  test('done: the materials are used, the stock added, and each size’s cost locked as it was', async () => {
    const batch = (await shop()).BATCHES.find((x: any) => x.state === 'planned').id;
    const [m, xxl] = [await stock('gcm', 'Black', 'M'), await stock('gcm', 'Black', 'XXL')];
    expect((await act(kai, 'batch-done', { batch })).status).toBe(200);
    expect([await stock('gcm', 'Black', 'M'), await stock('gcm', 'Black', 'XXL')]).toEqual([m + 2, xxl + 3]);
    expect(await onHand('blank')).toBe(91);
    expect((await act(kai, 'batch-done', { batch })).status).toBe(409);
    expect((await q(`SELECT size, state, unit_cost_cents FROM command.shop_runs WHERE batch_id = $1 ORDER BY id`, [batch])).map((r) => [r.size, r.state, r.unit_cost_cents])).toEqual([
      ['M', 'done', 1495],
      ['XXL', 'done', 1615],
    ]);
    // the print gets dearer: the batch's cost doesn't
    expect((await act(kai, 'purchase', { input: 'print', quantity: 10, total: 50 })).status).toBe(200);
    const d = await shop();
    const b = d.BATCHES.find((x: any) => x.id === batch);
    expect(b).toMatchObject({ state: 'done', estimate: false, madeShort: false, unitCost: Math.round(((2 * 14.95 + 3 * 16.15) / 5) * 100) / 100 });
    expect(b.needs).toBeUndefined();
    expect(d.RUNS.map((r: any) => [r.batch, r.size, r.unitCost])).toEqual([
      [batch, 'XXL', 16.15],
      [batch, 'M', 14.95],
    ]);
  });

  test('a single run is a batch of its own, its cost locked too', async () => {
    const r = await act(kai, 'run', { product: 'gcm', option: 'White', size: 'M', units: 1 });
    expect(r.body.result.batch).toMatch(/^B-\d{3}$/);
    // blank $10.35 + print $5.00
    expect((await q(`SELECT unit_cost_cents FROM command.shop_runs WHERE id = $1`, [r.body.result.id]))[0].unit_cost_cents).toBe(1535);
  });
});

describe('reorder suggestions', () => {
  test('when stock won’t last the lead time plus the buffer: how many, from whom, at what price', async () => {
    // 6 blanks used in the last four weeks: 1.5 a week. 90 last 60 weeks: nothing to do
    let r = (await shop()).REORDER.find((x: any) => x.input === 'blank');
    expect(r).toMatchObject({ onHand: 90, perWeek: 1.5, needWeeks: 2, leadDays: 7, due: false, suggest: null, type: 'stock' });
    expect((await act(kai, 'stock-adjust', { input: 'blank', quantity: -88, note: 'Recount' })).status).toBe(200);
    r = (await shop()).REORDER.find((x: any) => x.input === 'blank');
    // 2 last 1.3 weeks, under 2; 1.5 × (2 + 4) + the mark of 10 − 2 is 17, under the first break of 24
    expect([r.low, r.due]).toEqual([true, true]);
    expect(r.suggest).toEqual({ quantity: 24, supplier: 'wcb', unitCost: 10.4, discount: 0, total: 249.6, landsAt: NOW + 7 * DAY, second: true });
    // the once-per-order inputs counted on hand are in it too; the made-to-order ones aren't
    expect((await shop()).REORDER.map((x: any) => x.input).sort()).toEqual(['blank', 'mail', 'tis']);
  });
});

describe('orders: packing, pickup points and what each costs once', () => {
  test('pickup points are added and edited; an order is held at an active one', async () => {
    expect((await act(kai, 'pickup-point', { id: 'mesa', name: 'Mesa Laundry', city: 'San Bernardino' })).status).toBe(200);
    expect((await act(kai, 'pickup-point', { id: 'tire', name: 'Redlands Tire', city: 'Redlands', active: false })).status).toBe(200);
    expect((await act(kai, 'order-pickup', { order: '1092', point: 'mesa' })).status).toBe(200);
    expect((await act(kai, 'order-pickup', { order: '1092', point: 'tire' })).status).toBe(409);
    // a shipped order isn't held anywhere
    expect((await act(kai, 'order-pickup', { order: '1094', point: 'mesa' })).status).toBe(409);
    expect((await act(kai, 'pickup-point', { id: 'mesa', name: 'Mesa Laundry & Wash', city: 'San Bernardino' })).status).toBe(200);
    expect((await q(`SELECT pickup_point, pickup_at FROM command.shop_orders WHERE id = '1092'`))[0]).toEqual({ pickup_point: 'mesa', pickup_at: 'Mesa Laundry & Wash' });
  });

  test('packing uses the once-per-order inputs on hand; ready starts the hold', async () => {
    const [mail, tis] = [await onHand('mail'), await onHand('tis')];
    expect((await act(kai, 'pack', { order: '1094' })).status).toBe(200);
    expect([await onHand('mail'), await onHand('tis')]).toEqual([mail - 1, tis - 1]);
    // picked up: tissue only
    expect((await act(kai, 'pack', { order: '1092' })).status).toBe(200);
    expect([await onHand('mail'), await onHand('tis')]).toEqual([mail - 1, tis - 2]);
    expect((await q(`SELECT ref FROM command.shop_input_moves WHERE reason = 'order' ORDER BY id`)).map((r) => r.ref)).toEqual([1094, 1094, 1092]);
    expect((await act(kai, 'ready', { order: '1092' })).status).toBe(200);
    const d = await shop();
    // held 14 days (Settings' `hold`) from ready
    expect(d.PICKUP['1092']).toEqual({ point: 'mesa', readyAt: NOW, holdUntil: NOW + 14 * DAY, overdue: false });
    expect(d.POINTS).toEqual([
      { id: 'mesa', name: 'Mesa Laundry & Wash', city: 'San Bernardino', active: true, held: 1, last4w: 1 },
      { id: 'tire', name: 'Redlands Tire', city: 'Redlands', active: false, held: 0, last4w: 0 },
    ]);
  });

  test('a label recorded against the shipping charged, with the packing and the card fee', async () => {
    // 1093: one Graphic Tee at $44, paid by card
    expect((await act(kai, 'order-label', { order: '1093', cost: 7.4 })).status).toBe(200);
    expect((await act(kai, 'order-label', { order: '1092', cost: 7.4 })).status).toBe(409);
    const d = await shop();
    expect(d.ORDER_COSTS['1093']).toEqual({
      fulfilment: 'ship',
      supplies: [
        { input: 'mail', cost: 0.42 },
        { input: 'tis', cost: expect.any(Number) },
      ],
      suppliesCost: expect.any(Number),
      charged: 6,
      label: 7.4,
      gap: 1.4,
      fee: Math.round(4400 * 0.029 + 30) / 100,
      costedAt: expect.any(Number),
    });
    // a second label replaces the first
    expect((await act(kai, 'order-label', { order: '1093', cost: 8 })).status).toBe(200);
    expect((await shop()).ORDER_COSTS['1093'].gap).toBe(2);
    expect((await shop()).PER_ORDER).toMatchObject({ ship: { inputs: ['mail', 'tis'] }, pickup: { inputs: ['tis'] }, fee: { pct: 0.029, fixed: 0.3 }, charged: 6, label: 8, hold: 14, margin: 60, buffer: 1, shopbuy: 50, refund: 50 });
  });
});

describe('levels', () => {
  test('every one of these takes Propose: at See, each is refused', async () => {
    for (const [kind, body] of [
      ['supplier', { name: 'X' }],
      ['supplier-breaks', { supplier: 'wcb', breaks: [] }],
      ['input-supplier', { input: 'blank', supplier: null }],
      ['input-extra', { input: 'blank', size: 'S', extra: 1 }],
      ['input-kind', { input: 'blank', kind: 'mto' }],
      ['order-in', { input: 'blank', quantity: 1, total: 1 }],
      ['receive', { id: 1 }],
      ['order-cancel', { id: 1 }],
      ['flat-cost', { product: 'gdv', cost: 1 }],
      ['flat-override', { product: 'gdv', size: 'M', cost: 1 }],
      ['batch-plan', { product: 'gcm', option: 'Black', units: [{ size: 'M', n: 1 }] }],
      ['batch-done', { batch: 'B-001' }],
      ['batch-cancel', { batch: 'B-001' }],
      ['pickup-point', { name: 'X' }],
      ['order-pickup', { order: '1092', point: 'mesa' }],
      ['order-label', { order: '1093', cost: 1 }],
    ] as const)
      expect((await act(look, kind, body)).status, kind).toBe(403);
    // and at See, the page has it all
    const d = await shop(look);
    expect([d.SUPPLIERS.length > 0, d.BATCHES.length > 0, Object.keys(d.ORDER_COSTS).length > 0]).toEqual([true, true, true]);
  });

  test('at Totals: only the pickup points and their counts, and no one’s name, email or address anywhere', async () => {
    const d = await shop(tot);
    expect([d.SUPPLIERS, d.ON_ORDER, d.REORDER, d.BATCHES, d.PER_ORDER, d.ORDER_COSTS, d.PICKUP, d.COST_BY, d.FLAT]).toEqual([[], [], [], [], null, {}, {}, {}, {}]);
    expect(d.POINTS.map((p: any) => p.id)).toEqual(['mesa', 'tire']);
    const json = JSON.stringify(d);
    const names = (
      await q(
        `SELECT DISTINCT buyer AS n FROM command.shop_orders UNION SELECT DISTINCT who FROM command.shop_input_purchases UNION SELECT DISTINCT who FROM command.shop_runs UNION SELECT DISTINCT who FROM command.shop_history`,
      )
    )
      .map((r) => r.n as string)
      .filter((n) => n && n.length > 2);
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(json, n).not.toContain(`"${n}"`);
    expect(json).not.toContain('@');
  });
});
