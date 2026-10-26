import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { catalogFeed } from '../services/command/feedSources.js';
import { runFeed } from '../services/command/feeds.js';
import { SECTIONS, SEE, type Levels } from '../services/command/levels.js';
import { shopSection } from '../services/command/sections.js';
import { seedCommand } from '../services/command/seed.js';
import { commandRouter } from './command.js';

/*
 * Phase 10a, through the route: the shop's costing actions (an input, a purchase, a recipe line and
 * its overrides, a copy, an input onto several products, a stock move, a production run). They're
 * Command's own records: done at Propose, with nobody else, logged, and never in the outbox.
 */

let root = '';
let db: Db;

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
      adminEmails: () => ['kai@useclear.org'],
      appUrl: () => 'https://command.test',
      now: () => new Date('2026-10-24T17:00:00Z'),
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

type Who = { user: string; session?: string };
const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const r = await fetch(root + '/api/command' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
};
const signIn = async (user: string): Promise<Who> => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const all = (n: number): Levels => Object.fromEntries(SECTIONS.map((s) => [s, n])) as Levels;
const q = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T & Record<string, unknown>>(sql, p)).rows as T[];
const act = (who: Who, kind: string, body: unknown) => call(who, 'POST', `/actions/shop/${kind}`, body);
const onHand = async (iid: string) => Number((await q(`SELECT coalesce(sum(quantity), 0) AS n FROM command.shop_input_moves WHERE input_id = $1`, [iid]))[0].n);
const stock = async (pid: string, option: string, size: string) =>
  (await q(`SELECT on_hand FROM command.shop_stock WHERE product_id = $1 AND option = $2 AND size = $3`, [pid, option, size]))[0].on_hand as number;
const lines = async (pid: string) =>
  (await q(`SELECT input_id, amount, cost_cents FROM command.shop_recipe_lines WHERE product_id = $1 ORDER BY position`, [pid])).map((r) => [
    r.input_id,
    r.amount == null ? null : Number(r.amount),
    r.cost_cents == null ? null : Number(r.cost_cents),
  ]);

let kai: Who, look: Who;
beforeAll(async () => {
  kai = await signIn('did:kai|kai@useclear.org');
  await call(kai, 'POST', '/invites', { email: 'look@useclear.org', name: 'Look', group: 'outside' });
  look = await signIn('did:look|look@useclear.org');
  const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === 'look@useclear.org').id;
  expect((await call(kai, 'PATCH', `/people/${id}/access`, { custom: all(2) })).status).toBe(200);
});

describe('the inputs library', () => {
  test('an input is added, then edited by its id; labour is by the hour', async () => {
    const r = await act(kai, 'input', { id: 'blank', name: 'Blank tee', kind: 'material', unit: 'each', stocked: true, lowMark: 5 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ done: true, queued: false, result: { id: 'blank' } });
    expect((await act(kai, 'input', { id: 'blank', name: 'Blank tee (heavy)', kind: 'material', unit: 'each', stocked: true, lowMark: 5 })).status).toBe(200);
    expect((await q(`SELECT name, unit_cost_cents FROM command.shop_inputs WHERE id = 'blank'`))[0]).toEqual({ name: 'Blank tee (heavy)', unit_cost_cents: null });
    // an id from the name, when none is given
    const ink = await act(kai, 'input', { name: 'Screen ink', kind: 'material', unit: 'ML', unitCost: 0.0425 });
    expect(ink.body.result.id).toMatch(/^screen-ink-[a-z0-9]+$/);
    expect(Number((await q(`SELECT unit_cost_cents FROM command.shop_inputs WHERE id = $1`, [ink.body.result.id]))[0].unit_cost_cents)).toBe(4.25);
    for (const body of [
      { id: 'thread', name: 'Thread', kind: 'material', unit: 'm', stocked: true, unitCost: 0.05 },
      { id: 'embroidery', name: 'Embroidery', kind: 'service', unit: 'each', unitCost: 2.6 },
      { id: 'labour', name: 'Labour', kind: 'labour', unit: 'h', unitCost: 20 },
      { id: 'mailer', name: 'Mailer', kind: 'material', unit: 'each', stocked: true, unitCost: 0.4 },
    ])
      expect((await act(kai, 'input', body)).status).toBe(200);
    const bad = await act(kai, 'input', { name: 'Sewing', kind: 'labour', unit: 'each' });
    expect([bad.status, bad.body.error]).toEqual([400, 'Labour is costed by the hour (h)']);
    expect((await act(kai, 'input', { name: 'Printing', kind: 'service', unit: 'each', stocked: true })).status).toBe(400);
    const [audit] = await q(`SELECT result FROM command.audit_log WHERE action = 'Added input Thread'`);
    expect(audit.result).toBe('done');
  });

  test('a purchase sets the unit cost, and a stocked input gets the stock', async () => {
    const r = await act(kai, 'purchase', { input: 'blank', quantity: 20, total: 164, supplier: 'Blanks Co' });
    expect(r.status).toBe(200);
    expect(r.body.result.unitCost).toBe(8.2);
    expect(Number((await q(`SELECT unit_cost_cents FROM command.shop_inputs WHERE id = 'blank'`))[0].unit_cost_cents)).toBe(820);
    expect(await onHand('blank')).toBe(20);
    // one dated before the newest is history: it doesn't set the cost
    expect((await act(kai, 'purchase', { input: 'blank', quantity: 10, total: 100, on: '2026-01-01' })).status).toBe(200);
    expect(Number((await q(`SELECT unit_cost_cents FROM command.shop_inputs WHERE id = 'blank'`))[0].unit_cost_cents)).toBe(820);
    expect(await onHand('blank')).toBe(30);
    // made to order: the cost changes, no stock
    expect((await act(kai, 'purchase', { input: 'embroidery', quantity: 10, total: 26 })).status).toBe(200);
    expect(await onHand('embroidery')).toBe(0);
    expect((await act(kai, 'purchase', { input: 'thread', quantity: 500, total: 25 })).status).toBe(200);
    expect((await act(kai, 'purchase', { input: 'mailer', quantity: 50, total: 20 })).status).toBe(200);
    expect((await q(`SELECT action FROM command.audit_log WHERE action LIKE 'Bought 20 each of Blank tee%'`))[0].action).toBe('Bought 20 each of Blank tee (heavy) · $164.00');
  });
});

describe('recipes', () => {
  test('a line by amount and a line by cost, then one taken out', async () => {
    expect((await act(kai, 'recipe-line', { product: 'gcm', input: 'blank', amount: 1 })).status).toBe(200);
    expect((await act(kai, 'recipe-line', { product: 'gcm', input: 'thread', amount: 12 })).status).toBe(200);
    // $5.20 of embroidery at $2.60 a piece
    expect((await act(kai, 'recipe-line', { product: 'gcm', input: 'embroidery', cost: 5.2 })).status).toBe(200);
    // both given: the amount wins
    expect((await act(kai, 'recipe-line', { product: 'gcm', input: 'labour', amount: 0.25, cost: 99 })).status).toBe(200);
    expect((await act(kai, 'recipe-line', { product: 'gcm', input: 'mailer', amount: 1 })).status).toBe(200);
    expect(await lines('gcm')).toEqual([
      ['blank', 1, null],
      ['thread', 12, null],
      // typed as a cost, kept with the amount it works out to, so a change to the unit cost flows through
      ['embroidery', 2, 520],
      ['labour', 0.25, null],
      ['mailer', 1, null],
    ]);
    expect((await q(`SELECT entered FROM command.shop_recipe_lines WHERE product_id = 'gcm' AND input_id = 'embroidery'`))[0].entered).toBe('cost');
    expect((await act(kai, 'recipe-line', { product: 'gcm', input: 'mailer', remove: true })).status).toBe(200);
    expect((await act(kai, 'recipe-line', { product: 'gcm', input: 'mailer', remove: true })).status).toBe(404);
    expect((await act(kai, 'recipe-line', { product: 'gcm', input: 'blank' })).status).toBe(400);
    expect((await act(kai, 'recipe-line', { product: 'nope', input: 'blank', amount: 1 })).status).toBe(404);
    expect((await q(`SELECT what FROM command.shop_history WHERE product_id = 'gcm' ORDER BY id DESC LIMIT 1`))[0].what).toBe('Recipe · took out Mailer');
  });

  test('a size’s override, for a size the product has', async () => {
    expect((await act(kai, 'recipe-override', { product: 'gcm', input: 'blank', size: 'XXL', cost: 9.8 })).status).toBe(200);
    expect((await act(kai, 'recipe-override', { product: 'gcm', input: 'thread', option: 'Cobalt', amount: 20 })).status).toBe(200);
    expect((await act(kai, 'recipe-override', { product: 'gcm', input: 'blank', option: 'Plaid', amount: 1 })).status).toBe(404);
    expect((await act(kai, 'recipe-override', { product: 'gcm', input: 'mailer', size: 'M', amount: 1 })).status).toBe(404);
    expect((await act(kai, 'recipe-override', { product: 'gcm', input: 'blank', amount: 1 })).status).toBe(400);
    const r = (await call(kai, 'GET', '/sections/shop')).body.RECIPES.gcm;
    // 820 blank + 60 thread + 520 embroidery + 500 labour
    expect(r.cost).toBe(19);
    expect(r.variants.find((v: any) => v.option === 'Black' && v.size === 'XXL').cost).toBe(20.6);
    expect(r.variants.find((v: any) => v.option === 'Cobalt' && v.size === 'M').cost).toBe(19.4);
    expect((await act(kai, 'recipe-override', { product: 'gcm', input: 'thread', option: 'Cobalt', remove: true })).status).toBe(200);
  });

  test('a recipe copied onto others: replace makes it the copy, merge keeps what they have', async () => {
    await act(kai, 'recipe-line', { product: 'gtt', input: 'labour', amount: 1 });
    await act(kai, 'recipe-line', { product: 'gtt', input: 'mailer', amount: 1 });
    await act(kai, 'recipe-line', { product: 'gdv', input: 'labour', amount: 1 });
    await act(kai, 'recipe-line', { product: 'gdv', input: 'mailer', amount: 1 });
    expect((await act(kai, 'recipe-copy', { from: 'gcm', to: ['gtt'], mode: 'replace' })).status).toBe(200);
    expect(await lines('gtt')).toEqual(await lines('gcm'));
    // the XXL override came too: Two Ten has an XXL
    expect((await q(`SELECT size FROM command.shop_recipe_overrides WHERE product_id = 'gtt'`)).map((r) => r.size)).toEqual(['XXL']);
    const m = await act(kai, 'recipe-copy', { from: 'gcm', to: ['gdv'], mode: 'merge' });
    expect(m.body.result.lines).toBe(3);
    expect(await lines('gdv')).toEqual([
      ['labour', 1, null],
      ['mailer', 1, null],
      ['blank', 1, null],
      ['thread', 12, null],
      ['embroidery', 2, 520],
    ]);
    expect((await act(kai, 'recipe-copy', { from: 'gcm', to: ['gcm'], mode: 'merge' })).status).toBe(400);
    expect((await act(kai, 'recipe-copy', { from: 'hd', to: ['gcm'], mode: 'merge' })).status).toBe(409);
  });

  test('one input onto several products at once; one that has it gets the new amount', async () => {
    const r = await act(kai, 'input-apply', { input: 'mailer', products: ['gcm', 'gtt', 'gdv'], amount: 2 });
    expect([r.status, r.body.result.products]).toEqual([200, 3]);
    for (const pid of ['gcm', 'gtt', 'gdv']) expect((await lines(pid)).find((l) => l[0] === 'mailer')).toEqual(['mailer', 2, null]);
    // gdv's mailer kept its place
    expect((await lines('gdv'))[1][0]).toBe('mailer');
  });

  test('an archived input stays in recipes but can’t be added to one', async () => {
    expect((await act(kai, 'input-archive', { id: 'labour' })).status).toBe(200);
    expect((await act(kai, 'recipe-line', { product: 'hd', input: 'labour', amount: 1 })).status).toBe(409);
    const d = (await call(kai, 'GET', '/sections/shop')).body;
    expect(d.INPUTS.find((i: any) => i.id === 'labour')).toMatchObject({ archived: true, usedIn: 3 });
    expect(d.RECIPES.gcm.lines.some((l: any) => l.input === 'labour')).toBe(true);
    expect((await act(kai, 'input-archive', { id: 'labour', archived: false })).status).toBe(200);
  });
});

describe('stock', () => {
  test('an adjustment or waste is a move; waste only takes out, and never below nothing', async () => {
    expect((await act(kai, 'stock-adjust', { input: 'thread', quantity: -20, reason: 'waste', note: 'Tangled' })).status).toBe(200);
    expect(await onHand('thread')).toBe(480);
    expect((await act(kai, 'stock-adjust', { input: 'thread', quantity: 5 })).body.result.onHand).toBe(485);
    expect((await act(kai, 'stock-adjust', { input: 'thread', quantity: 5, reason: 'waste' })).status).toBe(400);
    expect((await act(kai, 'stock-adjust', { input: 'thread', quantity: -1000 })).status).toBe(409);
    expect((await act(kai, 'stock-adjust', { input: 'embroidery', quantity: 1 })).status).toBe(409);
  });

  test('a run uses up the stocked inputs by the recipe and adds the finished units', async () => {
    const before = await stock('gcm', 'Black', 'M');
    const r = await act(kai, 'run', { product: 'gcm', option: 'Black', size: 'M', units: 12, note: 'First batch' });
    expect(r.status).toBe(200);
    expect(r.body.result.uses).toEqual([
      { input: 'blank', quantity: 12 },
      { input: 'thread', quantity: 144 },
      { input: 'mailer', quantity: 24 },
    ]);
    expect(await stock('gcm', 'Black', 'M')).toBe(before + 12);
    expect([await onHand('blank'), await onHand('thread'), await onHand('mailer')]).toEqual([18, 341, 26]);
    // embroidery and labour are made to order: no moves
    expect((await q(`SELECT count(*)::int AS n FROM command.shop_input_moves WHERE reason = 'run' AND input_id IN ('embroidery', 'labour')`))[0].n).toBe(0);
    expect((await q(`SELECT action FROM command.audit_log WHERE action LIKE 'Made 12 Graphic Tee%'`))[0].action).toBe('Made 12 Graphic Tee · Black M');
  });

  test('a run that would take an input below zero is refused, unless allowed short', async () => {
    const before = await stock('gcm', 'White', 'L');
    // 15 tees: 15 of the 18 blanks, but 30 of the 26 mailers
    const r = await act(kai, 'run', { product: 'gcm', option: 'White', size: 'L', units: 15 });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('Not enough on hand: Mailer has 26 each, the run needs 30');
    expect(await stock('gcm', 'White', 'L')).toBe(before);
    expect(await onHand('mailer')).toBe(26);
    const ok = await act(kai, 'run', { product: 'gcm', option: 'White', size: 'L', units: 15, allowShort: true });
    expect([ok.status, ok.body.result.short]).toEqual([200, ['mailer']]);
    expect(await stock('gcm', 'White', 'L')).toBe(before + 15);
    expect([await onHand('blank'), await onHand('mailer')]).toEqual([3, -4]);
    expect((await q(`SELECT short FROM command.shop_runs WHERE id = $1`, [ok.body.result.id]))[0].short).toBe(true);
    expect((await act(kai, 'run', { product: 'gcm', option: 'Plaid', size: 'L', units: 1 })).status).toBe(404);
  });

  test('a product with no recipe yet adds its units and uses nothing', async () => {
    const before = await stock('hd', 'Black', 'M');
    const r = await act(kai, 'run', { product: 'hd', option: 'Black', size: 'M', units: 2 });
    expect([r.status, r.body.result.uses]).toEqual([200, []]);
    expect(await stock('hd', 'Black', 'M')).toBe(before + 2);
  });
});

describe('levels and the payload', () => {
  test('someone at See reads the costing but can’t change it', async () => {
    for (const [kind, body] of [
      ['input', { name: 'Glue', kind: 'material', unit: 'g' }],
      ['input-archive', { id: 'blank' }],
      ['purchase', { input: 'blank', quantity: 1, total: 1 }],
      ['recipe-line', { product: 'gcm', input: 'blank', amount: 2 }],
      ['recipe-override', { product: 'gcm', input: 'blank', size: 'S', amount: 2 }],
      ['recipe-copy', { from: 'gcm', to: ['hd'], mode: 'replace' }],
      ['input-apply', { input: 'blank', products: ['hd'], amount: 1 }],
      ['stock-adjust', { input: 'blank', quantity: 1 }],
      ['run', { product: 'gcm', option: 'Black', size: 'M', units: 1 }],
    ] as const)
      expect((await act(look, kind, body)).status).toBe(403);
    const d = (await call(look, 'GET', '/sections/shop')).body;
    expect(d.INPUTS.length).toBe(6);
    // nothing went to the outbox: these are Command's own records
    expect((await q(`SELECT count(*)::int AS n FROM command.outbox WHERE kind IN ('input', 'purchase', 'recipe-line', 'recipe-copy', 'input-apply', 'run', 'stock-adjust')`))[0].n).toBe(0);
  });

  test('the page gets the recipe’s cost as the product’s, and the materials on hand', async () => {
    const d = (await call(kai, 'GET', '/sections/shop')).body;
    // 820 blank + 60 thread + 520 embroidery + 500 labour + 80 for two mailers
    const gcm = d.PR.find((p: any) => p.id === 'gcm');
    expect(gcm.c).toEqual([19.8, 0, 0, 0]);
    expect(d.RECIPES.gcm.margin).toEqual({ amount: 24.2, share: 2420 / 4400 });
    expect(d.PR.find((p: any) => p.id === 'hd').c).toEqual([26.8, 6.4, 1.2, 1.6]);
    expect(d.MATERIALS.low).toEqual(['blank']);
    // the mailers ran short: none until more come
    expect(d.MATERIALS.makes.gcm).toEqual({ units: 0, binding: 'mailer' });
  });
});

describe('a change to an input’s cost', () => {
  test('flows into every recipe that uses it, lines typed as a cost included', async () => {
    // embroidery was $2.60 a piece, and the line was typed as $5.20: 2 pieces. Now it's $3.00 a piece.
    expect((await act(kai, 'purchase', { input: 'embroidery', quantity: 10, total: 30 })).status).toBe(200);
    const line = (await lines('gcm')).find((l) => l[0] === 'embroidery');
    expect(line).toEqual(['embroidery', 2, 520]);
    const d = (await call(kai, 'GET', '/sections/shop')).body;
    // the editor still shows what was typed
    expect(d.RECIPES.gcm.lines.find((l: any) => l.input === 'embroidery')).toMatchObject({ amount: 2, cost: 6, entered: 'cost', typed: 5.2 });
  });

  test('a line typed as a cost before its input had any cost gets its amount when the cost comes', async () => {
    expect((await act(kai, 'input', { id: 'dye', name: 'Dye', kind: 'material', unit: 'ml' })).status).toBe(200);
    expect((await act(kai, 'recipe-line', { product: 'gcm', input: 'dye', cost: 1.2 })).status).toBe(200);
    expect((await lines('gcm')).find((l) => l[0] === 'dye')).toEqual(['dye', null, 120]);
    const before = (await call(kai, 'GET', '/sections/shop')).body.RECIPES.gcm.lines.find((l: any) => l.input === 'dye');
    expect(before).toMatchObject({ amount: null, cost: 1.2, typed: 1.2, note: 'No unit cost yet, so the amount is worked out once it has one' });
    // $0.04 a ml: $1.20 is 30 ml, and from now on the cost follows the dye's
    expect((await act(kai, 'input', { id: 'dye', name: 'Dye', kind: 'material', unit: 'ml', unitCost: 0.04 })).status).toBe(200);
    expect((await lines('gcm')).find((l) => l[0] === 'dye')).toEqual(['dye', 30, 120]);
  });
});

describe('stock history, runs and Home’s alerts (Phase 10c)', () => {
  test('each input carries its purchases and its stock ledger, newest first', async () => {
    const d = (await call(kai, 'GET', '/sections/shop')).body;
    const blank = d.INPUTS.find((i: any) => i.id === 'blank');
    // the one dated 1 Jan is older than the one recorded "now"
    expect(blank.purchases.map((p: any) => [p.quantity, p.total, p.unitCost, p.supplier])).toEqual([
      [20, 164, 8.2, 'Blanks Co'],
      [10, 100, 10, ''],
    ]);
    expect(blank.purchases[1]).toMatchObject({ at: Date.parse('2026-01-01T00:00:00Z'), note: '' });
    // two runs (the short one last), then the two purchases, each with what it came from
    expect(blank.moves.map((m: any) => [m.quantity, m.reason])).toEqual([
      [-15, 'run'],
      [-12, 'run'],
      [20, 'purchase'],
      [10, 'purchase'],
    ]);
    const runs = await q<{ id: number }>(`SELECT id FROM command.shop_runs WHERE product_id = 'gcm' ORDER BY id`);
    expect(blank.moves[0].ref).toBe(runs[1].id);
    expect(blank.moves[2]).toMatchObject({ note: 'Blanks Co' });
    const thread = d.INPUTS.find((i: any) => i.id === 'thread');
    expect(thread.moves.slice(-3).map((m: any) => [m.quantity, m.reason, m.note])).toEqual([
      [5, 'adjust', ''],
      [-20, 'waste', 'Tangled'],
      [500, 'purchase', ''],
    ]);
    // made to order: purchases, no ledger
    const emb = d.INPUTS.find((i: any) => i.id === 'embroidery');
    expect([emb.purchases.length, emb.moves]).toEqual([2, []]);
  });

  test('RUNS: the runs newest first, with what each used and whether it ran short', async () => {
    const d = (await call(kai, 'GET', '/sections/shop')).body;
    expect(d.RUNS.map((r: any) => [r.product, r.option, r.size, r.units, r.short, r.note])).toEqual([
      ['hd', 'Black', 'M', 2, false, ''],
      ['gcm', 'White', 'L', 15, true, ''],
      ['gcm', 'Black', 'M', 12, false, 'First batch'],
    ]);
    expect(d.RUNS[1].uses).toEqual([
      { input: 'blank', quantity: 15 },
      { input: 'thread', quantity: 180 },
      { input: 'mailer', quantity: 30 },
    ]);
    // no recipe: it used nothing
    expect(d.RUNS[0].uses).toEqual([]);
    expect(d.RUNS[2]).toMatchObject({ who: expect.any(String), at: expect.any(Number) });
    expect(typeof d.RUNS[2].id).toBe('number');
    // MATERIALS.covers: each stocked input on its own, by the recipe as written
    expect(d.MATERIALS.covers.blank).toMatchObject({ gcm: 3 });
    expect(d.MATERIALS.covers.mailer).toMatchObject({ gcm: 0 });
  });

  test('Home: the low materials ride along, from See', async () => {
    const h = (await call(kai, 'GET', '/sections/home')).body;
    // 3 blanks left, under the mark of 5; the mailers have no mark
    expect(h.LOW_MATERIALS).toEqual([{ input: 'blank', name: 'Blank tee (heavy)', unit: 'each', onHand: 3, lowMark: 5 }]);
    expect((await call(look, 'GET', '/sections/home')).body.LOW_MATERIALS).toHaveLength(1);
    // at the mark counts as low, as MATERIALS.low has it; archived doesn't
    await act(kai, 'input', { id: 'thread', name: 'Thread', kind: 'material', unit: 'm', stocked: true, lowMark: 161 });
    expect((await call(kai, 'GET', '/sections/home')).body.LOW_MATERIALS.map((x: any) => x.input)).toEqual(['blank', 'thread']);
    await act(kai, 'input-archive', { id: 'thread' });
    expect((await call(kai, 'GET', '/sections/home')).body.LOW_MATERIALS.map((x: any) => x.input)).toEqual(['blank']);
    await act(kai, 'input-archive', { id: 'thread', archived: false });
    // below See, nothing
    const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === 'look@useclear.org').id;
    expect((await call(kai, 'PATCH', `/people/${id}/access`, { custom: all(1) })).status).toBe(200);
    expect((await call(look, 'GET', '/sections/home')).body.LOW_MATERIALS).toEqual([]);
    expect((await call(kai, 'PATCH', `/people/${id}/access`, { custom: all(2) })).status).toBe(200);
  });

  test('the history is capped: 20 purchases and 30 moves an input', async () => {
    for (let n = 0; n < 25; n++) await db.query(`INSERT INTO command.shop_input_purchases (input_id, at, quantity, total_cents) VALUES ('embroidery', $1, 1, 300)`, [new Date(Date.UTC(2026, 5, 1 + n))]);
    for (let n = 0; n < 35; n++) await db.query(`INSERT INTO command.shop_input_moves (input_id, at, quantity, reason) VALUES ('thread', $1, 1, 'adjust')`, [new Date(Date.UTC(2026, 5, 1 + n))]);
    const d = (await call(kai, 'GET', '/sections/shop')).body;
    const emb = d.INPUTS.find((i: any) => i.id === 'embroidery');
    const thread = d.INPUTS.find((i: any) => i.id === 'thread');
    expect([emb.purchases.length, thread.moves.length]).toEqual([20, 30]);
    const at = (xs: any[]) => xs.map((x) => x.at);
    expect(at(thread.moves)).toEqual([...at(thread.moves)].sort((a, b) => b - a));
    expect(at(emb.purchases)).toEqual([...at(emb.purchases)].sort((a, b) => b - a));
  });
});

describe('live, a product only the site sells: Command’s record is made the first time it’s acted on', () => {
  const site = (slug: string, name: string, kind: string, colours: string[], variants: string[]) => ({
    slug, section: 'goods', name, kind, category: 'Wear', alsoIn: ['Logo'], priceCents: 3200, status: 'live',
    colours: colours.map((c) => ({ id: c.toLowerCase(), label: c })), variants: variants.map((v) => ({ id: v, label: v })),
  });
  const envShop = process.env.PROVIDER_SHOP;
  beforeAll(async () => {
    const catalog = { products: [site('logo-long-sleeve-tee', 'Logo Long Sleeve Tee', 'tee-ls', ['Black', 'White'], ['black-m', 'white-l']), site('logo-patch', 'Logo Patch', 'patch', [], ['square', 'circle'])], moved: {} };
    expect(await runFeed(db, catalogFeed({}, (async () => new Response(JSON.stringify(catalog))) as unknown as typeof fetch))).toBe('ok');
    process.env.PROVIDER_SHOP = 'live';
  });
  afterAll(() => {
    if (envShop == null) delete process.env.PROVIDER_SHOP;
    else process.env.PROVIDER_SHOP = envShop;
  });

  test('a recipe line: the record comes from the catalog, with no costs yet and stock at 0 for each colour and size', async () => {
    expect((await q(`SELECT 1 FROM command.shop_products WHERE id = 'logolongsleevetee'`)).length).toBe(0);
    const r = await act(kai, 'recipe-line', { product: 'logolongsleevetee', input: 'blank', amount: 1 });
    expect(r.status).toBe(200);
    expect((await q(`SELECT name, variant, line, status, cost_cents, slug, price_cents, deposit FROM command.shop_products WHERE id = 'logolongsleevetee'`))[0]).toEqual({
      name: 'Logo Tee', variant: 'Long sleeve', line: 'logo', status: 'on', cost_cents: null, slug: 'logo-long-sleeve-tee', price_cents: 3200, deposit: false,
    });
    expect(await lines('logolongsleevetee')).toEqual([['blank', 1, null]]);
    // two colours, six sizes each
    expect((await q(`SELECT count(*)::int AS n FROM command.shop_stock WHERE product_id = 'logolongsleevetee'`))[0].n).toBe(12);
    expect((await q(`SELECT what FROM command.shop_history WHERE product_id = 'logolongsleevetee' ORDER BY id`)).map((h) => h.what)).toEqual(['Command’s record started from the site’s catalog', 'Recipe · set Blank tee (heavy)']);
    // the page: its recipe, and still no costs entered in the boxes
    const s: any = await shopSection(db, { level: SEE, reveal: false, now: new Date('2026-10-24T17:00:00Z') });
    expect(s.RECIPES.logolongsleevetee.lines).toHaveLength(1);
    expect(s.PR.find((p: any) => p.id === 'logolongsleevetee')).toMatchObject({ slug: 'logo-long-sleeve-tee', nc: 1 });
  });

  test('a run lands in its stock; the shelf works on one with no sizes; one the site doesn’t sell is still no such product', async () => {
    expect((await act(kai, 'run', { product: 'logolongsleevetee', option: 'Black', size: 'M', units: 3, allowShort: true })).status).toBe(200);
    expect(await stock('logolongsleevetee', 'Black', 'M')).toBe(3);
    expect((await act(kai, 'shelf-off', { id: 'logopatch', why: 'Sold out' })).status).toBe(200);
    expect((await q(`SELECT status FROM command.shop_products WHERE id = 'logopatch'`))[0].status).toBe('off');
    expect((await q(`SELECT option, size FROM command.shop_stock WHERE product_id = 'logopatch' ORDER BY option_pos`)).map((x) => [x.option, x.size])).toEqual([['square', ''], ['circle', '']]);
    const r = await act(kai, 'recipe-line', { product: 'nosuchtee', input: 'blank', amount: 1 });
    expect([r.status, r.body.error]).toEqual([404, 'No such product']);
  });
});
