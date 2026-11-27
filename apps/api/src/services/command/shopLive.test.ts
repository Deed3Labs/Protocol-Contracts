import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { costHistory, costOrders, orderLineCost } from './costing.js';
import { catalogFeed, maskBuyer, productBySlug, shopAddress, shopFeed, variantParts } from './feedSources.js';
import { feedRows, runFeed } from './feeds.js';
import { SEE, TOTALS, type Level } from './levels.js';
import { moneySection, shopSection } from './sections.js';
import { seedCommand } from './seed.js';

/*
 * Phase 7a: the shop, live and read-only. Its orders and reservations come from the shop's Stripe
 * Checkout (a restricted key, GETs only), what it sells from the site's catalog, and the rest is
 * Command's own. No address is ever stored: packing reads one from Stripe.
 */

const NOW = new Date('2026-10-24T17:00:00Z');
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** A stand-in Stripe: answers GETs by path, refuses anything else, remembers what it was asked. */
function stripe(routes: Record<string, (q: URLSearchParams) => unknown>) {
  const asked: Array<{ method: string; path: string; q: URLSearchParams; auth: string | null }> = [];
  const f = (async (u: string | URL, init?: RequestInit) => {
    const url = new URL(String(u));
    asked.push({ method: init?.method ?? 'GET', path: url.pathname, q: url.searchParams, auth: new Headers(init?.headers).get('authorization') });
    if ((init?.method ?? 'GET') !== 'GET') return new Response('{"error":"write"}', { status: 405 });
    const k = Object.keys(routes).find((p) => url.pathname === p);
    return k ? new Response(JSON.stringify(routes[k](url.searchParams))) : new Response('{"error":{"message":"no such thing"}}', { status: 404 });
  }) as typeof fetch;
  return { f, asked };
}

const goodsPI = { id: 'pi_goods', metadata: {}, shipping: { name: 'Ana Ruiz', address: { line1: '12 Orange St', line2: null, city: 'Redlands', state: 'CA', postal_code: '92373', country: 'US' } } };
const reservePI = { id: 'pi_reserve', metadata: { kind: 'reservation', shop_id: 's1', shop: 'Mesa Laundry', r1: 'clear-point/counter/2/8900/5500/Jan 2027', s1: 'reserved' } };
let sessions: any[] = [];
let refunded = 0;
const shop = stripe({
  '/v1/checkout/sessions': () => ({ data: sessions, has_more: false }),
  '/v1/refunds': () => ({ data: refunded ? [{ id: 're_1', status: 'succeeded', payment_intent: 'pi_goods' }] : [] }),
  '/v1/payment_intents/pi_goods': () => ({ ...goodsPI, latest_charge: { amount_refunded: refunded } }),
  '/v1/checkout/sessions/cs_goods': () => ({ id: 'cs_goods', shipping_details: null }),
});
const env = { COMMAND_SHOP_STRIPE_KEY: 'rk_live_readonly' };

const catalog = {
  products: [
    { slug: 'logo-tee', section: 'goods', name: 'Logo Tee', kind: 'tee', category: 'Wear', alsoIn: ['Logo'], priceCents: 2700, status: 'live', colours: [{ id: 'black', label: 'Black' }, { id: 'white', label: 'White' }], variants: [{ id: 'black-m', label: 'Black · M' }] },
    { slug: 'logo-hoodie', section: 'goods', name: 'Logo Hoodie', kind: 'hoodie', category: 'Wear', alsoIn: ['Logo'], priceCents: 8800, status: 'live', colours: [{ id: 'black', label: 'Black' }], variants: [] },
    { slug: 'logo-patch', section: 'goods', name: 'Logo Patch', kind: 'patch', category: 'Accessories', alsoIn: ['Logo'], priceCents: 900, status: 'live', colours: [], variants: [{ id: 'square', label: 'Square' }, { id: 'circle', label: 'Circle' }] },
    { slug: 'clear-point', section: 'for-shops', name: 'Clear Point', kind: 'point', category: 'For shops', alsoIn: [], priceCents: 8900, status: 'live', colours: [], variants: [{ id: 'counter', label: 'Counter', depositCents: 5500 }, { id: 'table', label: 'Table', depositCents: 6000 }] },
    { slug: 'coop-cap', section: 'goods', name: 'Co-op Cap', kind: 'cap', category: 'Headwear', alsoIn: [], priceCents: 3200, status: 'draft', colours: [], variants: [{ id: 'one', label: 'One size' }] },
  ],
  moved: { hoodie: 'logo-hoodie' },
};

let db: Db;
const envShop = process.env.PROVIDER_SHOP;
beforeAll(async () => {
  ({ db } = await testDb());
  await seedCommand(db);
});
afterAll(() => {
  if (envShop == null) delete process.env.PROVIDER_SHOP;
  else process.env.PROVIDER_SHOP = envShop;
});

describe('the shop’s key', () => {
  test('its own restricted key, else the site’s secret key the API already holds; anything else is off', () => {
    expect(shopFeed(env).off()).toBeNull();
    expect(shopFeed({ SHOP_STRIPE_SECRET_KEY: 'sk_live_site' }).off()).toBeNull();
    expect(shopFeed({}).off()).toBe('Neither COMMAND_SHOP_STRIPE_KEY nor SHOP_STRIPE_SECRET_KEY is set');
    expect(shopFeed({ COMMAND_SHOP_STRIPE_KEY: 'pk_live_public' }).off()).toBe('the shop’s key isn’t a Stripe key (rk_… or sk_…)');
  });

  test('names and variants as the page shows them', () => {
    expect([maskBuyer('Ana Maria Ruiz'), maskBuyer('Cher'), maskBuyer('')]).toEqual(['Ana R.', 'Cher', 'A buyer']);
    expect([variantParts('black-m'), variantParts('off-white-xxl'), variantParts('circle'), variantParts('counter')]).toEqual([
      ['Black', 'M'],
      ['Off White', 'XXL'],
      ['Circle', ''],
      ['Counter', ''],
    ]);
  });
});

describe('the shop feed', () => {
  test('a paid order and a reservation come in; an unpaid session doesn’t; only GETs are sent', async () => {
    sessions = [
      { id: 'cs_goods', created: sec('2026-10-22T10:00:00Z'), payment_status: 'paid', amount_total: 6300, metadata: { items: 'logo-tee/black-mx2,logo-patch/circlex1', shippo_rate_id: 'r' }, payment_intent: goodsPI },
      { id: 'cs_reserve', created: sec('2026-10-23T09:00:00Z'), payment_status: 'paid', amount_total: 11000, metadata: { kind: 'reservation', shop_id: 's1' }, payment_intent: reservePI },
      { id: 'cs_unpaid', created: sec('2026-10-23T11:00:00Z'), payment_status: 'unpaid', amount_total: 2700, metadata: { items: 'logo-tee/white-sx1' }, payment_intent: null },
    ];
    expect(await runFeed(db, shopFeed(env, shop.f))).toBe('ok');
    expect(shop.asked.every((a) => a.method === 'GET' && a.auth === 'Bearer rk_live_readonly')).toBe(true);
    const { rows } = await db.query<any>(`SELECT * FROM command.shop_orders WHERE source = 'stripe'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: '1001', buyer: 'Ana R.', city: 'Redlands', state: 'paid', paid_with: 'card', fulfilment: 'ship', total_cents: 6300, payment_intent: 'pi_goods' });
    expect(rows[0].items).toEqual([['logo-tee', 'Black', 'M', 2], ['logo-patch', 'Circle', '', 1]]);
    // no address anywhere in what's kept
    expect(JSON.stringify(rows[0])).not.toContain('Orange St');
    // each line's cost is recorded as it comes in: the patch has no record in Command, so it costs nothing
    const costs = (await db.query<any>(`SELECT line, product_id, option, size, unit_cost_cents, source FROM command.shop_order_costs WHERE order_id = '1001' ORDER BY line`)).rows;
    const lts = await orderLineCost(db, 'lts', 'Black', 'M');
    expect(costs).toEqual([
      { line: 0, product_id: 'lts', option: 'Black', size: 'M', unit_cost_cents: lts.unitCostCents, source: lts.source },
      { line: 1, product_id: 'logo-patch', option: 'Circle', size: '', unit_cost_cents: 0, source: 'none' },
    ]);
    expect(lts.unitCostCents).toBeGreaterThan(0);
    expect((await feedRows(db)).get('shop')!.figures).toMatchObject({ orders: 1, costed: 1 });
    const pre = (await db.query<any>('SELECT * FROM command.shop_live_preorders')).rows;
    expect(pre).toEqual([expect.objectContaining({ payment_intent: 'pi_reserve', line: 1, shop: 'Mesa Laundry', slug: 'clear-point', variant: 'counter', units: 2, deposit_cents: 5500, state: 'held' })]);
  });

  test('syncing again adds nothing, and leaves Command’s packing as it was', async () => {
    await db.query(`UPDATE command.shop_orders SET state = 'packed' WHERE id = '1001'`);
    expect(await runFeed(db, shopFeed(env, shop.f))).toBe('ok');
    const { rows } = await db.query<any>(`SELECT id, state FROM command.shop_orders WHERE source = 'stripe'`);
    expect(rows).toEqual([{ id: '1001', state: 'packed' }]);
    expect((await feedRows(db)).get('shop')!.figures).toMatchObject({ orders: 0, costed: 0 });
    // it asks from a day before the newest order it has
    const since = Number(shop.asked.filter((a) => a.path === '/v1/checkout/sessions').at(-1)!.q.get('created[gte]'));
    expect(since).toBe(sec('2026-10-23T09:00:00Z') - 86_400);
  });

  test('a full refund in Stripe marks the order refunded', async () => {
    refunded = 6300;
    expect(await runFeed(db, shopFeed(env, shop.f))).toBe('ok');
    const { rows } = await db.query<any>(`SELECT state, refunded_cents FROM command.shop_orders WHERE id = '1001'`);
    expect(rows[0]).toEqual({ state: 'refund', refunded_cents: 6300 });
    refunded = 0;
    await db.query(`UPDATE command.shop_orders SET state = 'paid', refunded_cents = 0 WHERE id = '1001'`);
  });

  test('packing reads the address from Stripe for that order, and nothing else', async () => {
    expect(await shopAddress(db, '1001', env, shop.f)).toEqual({ name: 'Ana Ruiz', lines: ['12 Orange St', 'Redlands, CA 92373'] });
    expect(await shopAddress(db, '1094', env, shop.f)).toBeNull();
    await expect(shopAddress(db, '1001', {}, shop.f)).rejects.toThrow(/Neither/);
  });

  test('with the site’s secret key it still only reads', async () => {
    const before = shop.asked.length;
    expect(await runFeed(db, shopFeed({ SHOP_STRIPE_SECRET_KEY: 'sk_live_site' }, shop.f))).toBe('ok');
    const asked = shop.asked.slice(before);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((a) => a.method === 'GET' && a.auth === 'Bearer sk_live_site')).toBe(true);
  });
});

describe('the catalog feed', () => {
  test('reads the site’s catalog, drafts too with the shared token', async () => {
    const asked: Array<string | null> = [];
    const f = (async (_u: string, init?: RequestInit) => {
      asked.push(new Headers(init?.headers).get('authorization'));
      return new Response(JSON.stringify(catalog));
    }) as unknown as typeof fetch;
    expect(await runFeed(db, catalogFeed({ COMMAND_CATALOG_TOKEN: 'tok' }, f))).toBe('ok');
    expect(asked).toEqual(['Bearer tok']);
    expect((await feedRows(db)).get('catalog')!.figures).toMatchObject({ drafts: true, products: expect.any(Array), moved: { hoodie: 'logo-hoodie' } });
    const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    expect(await runFeed(db, catalogFeed({}, bad))).toBe('error');
    // put the good read back for the section
    await runFeed(db, catalogFeed({ COMMAND_CATALOG_TOKEN: 'tok' }, f));
  });
});

describe('Shop, live', () => {
  beforeAll(() => {
    process.env.PROVIDER_SHOP = 'live';
  });
  const read = (level: Level = SEE) => shopSection(db, { level, reveal: false, now: NOW }) as Promise<any>;

  test('what it sells is the site’s, with Command’s own costs and glyphs where it has them', async () => {
    const s = await read();
    const by = Object.fromEntries(s.PR.map((p: any) => [p.slug, p]));
    expect(s.PR.map((p: any) => p.slug)).toEqual(['logo-tee', 'logo-hoodie', 'logo-patch', 'clear-point', 'coop-cap']);
    // the seed's Logo Tee record (same slug) brings its id and costs; the site's price wins
    expect(by['logo-tee']).toMatchObject({ id: 'lts', n: 'Logo Tee', v: 'Short sleeve', line: 'logo', price: 27, st: 'on', cols: ['Black', 'White'] });
    expect(by['logo-tee'].c).toHaveLength(4);
    // the old "hoodie" record finds the renamed product
    expect(by['logo-hoodie']).toMatchObject({ id: 'hd', g: 'hood', line: 'layers', price: 88 });
    // no record: costs not entered, said so rather than a 100% margin
    expect(by['logo-patch']).toMatchObject({ id: 'logopatch', line: 'patch', g: 'psq', nc: 1, cols: ['Square', 'Circle'] });
    // hardware reserves its smallest deposit, its full price alongside
    expect(by['clear-point']).toMatchObject({ id: 'cpt', line: 'hw', dep: 1, price: 55, full: 89 });
    expect(by['coop-cap']).toMatchObject({ st: 'draft' });
  });

  test('orders and reservations are the live ones, items pointing at the products; sales by week from them', async () => {
    const s = await read();
    const lts = (await orderLineCost(db, 'lts', 'Black', 'M')).unitCostCents / 100;
    // from See each line carries what it cost when it sold; the patch has no record in Command, so nothing
    expect(s.ORDERS).toEqual([['1001', Date.parse('2026-10-22T10:00:00Z'), 'Ana R.', 0, [['lts', 'Black', 'M', 2, lts], ['logopatch', 'Circle', '', 1, 0]], 'card', 'ship', '', 'paid', 'Redlands']]);
    expect(s.PRE).toEqual([['eserve-1', 'Mesa Laundry', 'cpt', 'Counter', 2, 'held', Date.parse('2026-10-23T09:00:00Z')]]);
    expect(s.PR.find((p: any) => p.id === 'lts').wk).toEqual([0, 0, 0, 0, 0, 0, 0, 2]);
    expect(s.figures['shop.orders_weekly']).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(s.figures['shop.size_mix']).toContainEqual(['M', 2]);
  });

  test('at Totals an order leaves with no buyer, city or time', async () => {
    const s = await read(TOTALS);
    expect(s.ORDERS[0]).toEqual(['1001', 0, '', 0, [['lts', 'Black', 'M', 2], ['logopatch', 'Circle', '', 1]], 'card', 'ship', '', 'paid', '']);
    expect(s.COST_HIST).toEqual({});
    expect(s.RETURNS).toEqual([]);
  });

  test('what a sale costs (Phase 10d): the cost at sale stays when the recipe changes; a line not costed yet uses today’s', async () => {
    const at = (await orderLineCost(db, 'lts', 'Black', 'M')).unitCostCents;
    const before = await read();
    expect(before.figures['shop.cost_weekly']).toEqual([0, 0, 0, 0, 0, 0, 0, (2 * at) / 100]);
    // the shirt's costs go up after it sold
    const { rows } = await db.query<{ cost_cents: number[] }>(`SELECT cost_cents FROM command.shop_products WHERE id = 'lts'`);
    await db.query(`UPDATE command.shop_products SET cost_cents = $1 WHERE id = 'lts'`, [rows[0].cost_cents.map((c, i) => (i === 0 ? c + 500 : c))]);
    const after = await read();
    expect(after.ORDERS[0][4][0][4]).toBe(at / 100);
    expect(after.figures['shop.cost_weekly']).toEqual(before.figures['shop.cost_weekly']);
    // with no record, the week falls back to today's cost
    await db.query(`DELETE FROM command.shop_order_costs WHERE order_id = '1001'`);
    const bare = await read();
    expect(bare.ORDERS[0][4][0][4]).toBeNull();
    expect(bare.figures['shop.cost_weekly'][7]).toBe((2 * (at + 500)) / 100);
    // costing it now records today's cost, and only once
    expect(await costOrders(db, await productBySlug(db))).toBe(1);
    expect(await costOrders(db, await productBySlug(db))).toBe(0);
    expect((await read()).ORDERS[0][4][0][4]).toBe((at + 500) / 100);
    await db.query(`UPDATE command.shop_products SET cost_cents = $1 WHERE id = 'lts'`, [rows[0].cost_cents]);
  });

  test('a product’s cost over time is by week from its sales, marked when it was costed after it sold', async () => {
    await db.query(`UPDATE command.shop_order_costs SET costed_at = '2026-10-22T10:05:00Z' WHERE order_id = '1001'`);
    const s = await read();
    const lts = (await db.query<{ unit_cost_cents: number }>(`SELECT unit_cost_cents FROM command.shop_order_costs WHERE order_id = '1001' AND line = 0`)).rows[0].unit_cost_cents;
    // the week of Monday 19 October; the patch, with no record in Command, isn't a cost
    expect(s.COST_HIST).toEqual({ lts: [{ week: Date.parse('2026-10-19T00:00:00Z'), low: lts / 100, high: lts / 100, units: 2, later: false }] });
    await db.query(`UPDATE command.shop_order_costs SET costed_at = '2026-10-25T09:00:00Z' WHERE order_id = '1001'`);
    expect((await costHistory(db)).lts[0].later).toBe(true);
  });

  test('Money’s set-asides are the shop’s live ones: the deposits held, the tax on the last 4 weeks', async () => {
    const m: any = await moneySection(db, { level: SEE, reveal: false, now: NOW });
    expect(m.SET_ASIDE.preorderDeposits).toBe(110);
    expect(m.SET_ASIDE.salesTax).toBeGreaterThan(0);
  });
});
