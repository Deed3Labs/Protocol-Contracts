import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { revalidateSite } from '../services/command/catalog.js';
import { catalogFeed } from '../services/command/feedSources.js';
import { feedRows, runFeed } from '../services/command/feeds.js';
import { SEE } from '../services/command/levels.js';
import { shopSection } from '../services/command/sections.js';
import { commandCatalogRouter, commandRouter } from './command.js';

/*
 * Phase 11a, through the routes: Command runs the shop's catalog. The site's full catalog is imported
 * once a product; from then on Command's record is the catalog, served publicly at
 * /api/command/catalog (drafts with the token), and edited by the shop's actions, a live product's
 * price only with a second person. Live, as dev runs: no seed.
 */

const TOKEN = 'catalog-token-for-tests';
let root = '';
let pings = 0;
let db: Db;
const envShop = process.env.PROVIDER_SHOP;

const colour = (id: string, label: string, swatch: string, tone: 'ink' | 'paper') => ({ id, label, swatch, tone });
const tee = {
  slug: 'logo-tee',
  section: 'goods',
  name: 'Logo Tee',
  line: 'Heavyweight cotton, mock neck, patch on the chest.',
  description: 'A heavy tee with a wide mock neck and the Clear patch stitched small on the chest.',
  priceCents: 2700,
  kind: 'tee',
  category: 'Wear',
  alsoIn: ['Logo'],
  variantLabel: 'Size',
  colours: [colour('black', 'Black', '#232324', 'ink'), colour('white', 'White', '#EDEDEA', 'paper')],
  variants: ['black', 'white'].flatMap((c) => ['s', 'm'].map((sz) => ({ id: `${c}-${sz}`, label: `${c === 'black' ? 'Black' : 'White'} · ${sz.toUpperCase()}`, colour: c, size: sz }))),
  details: ['Heavyweight cotton jersey', 'Embroidered patch'],
  weightOz: 9,
  ships: 'Jan 2027',
  status: 'live',
};
const patch = {
  slug: 'logo-patch',
  section: 'goods',
  name: 'Logo Patch',
  line: 'The patch on its own.',
  description: 'The embroidered patch.',
  priceCents: 900,
  kind: 'patch',
  category: 'Accessories',
  alsoIn: ['Logo'],
  variantLabel: 'Shape',
  colours: [],
  variants: [
    { id: 'square', label: 'Square' },
    { id: 'circle', label: 'Circle', soldOut: true },
  ],
  details: ['Embroidered'],
  weightOz: 1,
  ships: 'Jan 2027',
  images: [{ src: '/shop/goods/patch/photo.jpg', alt: 'The patch' }],
  status: 'live',
};
const point = {
  slug: 'clear-point',
  section: 'for-shops',
  name: 'Clear Point',
  line: 'E-paper for every table and the counter.',
  description: 'Shows the table number and the bill.',
  priceCents: 8900,
  kind: 'point',
  category: 'For shops',
  alsoIn: [],
  variantLabel: 'Size',
  colours: [],
  variants: [
    { id: 'table', label: 'Table', priceCents: 8900, depositCents: 5500 },
    { id: 'ten', label: 'Ten for tables', priceCents: 79000, depositCents: 52000, per: 'for ten' },
  ],
  details: ['4.2″ e-paper'],
  weightOz: 16,
  preorder: { ships: 'Feb 2027', fcc: true },
  fcc: 'Clear Point is awaiting FCC equipment authorization.',
  founding: 'Founding partners: table Points are $59.',
  status: 'live',
};
const cap = { ...patch, slug: 'coop-cap', name: 'Co-op Cap', kind: 'cap', category: 'Headwear', variants: [{ id: 'one', label: 'One size' }], images: undefined, status: 'draft' };
let site = { products: [tee, patch, point, cap] as any[], moved: { 'member-tee': 'logo-tee' } as Record<string, string> };
const asked: Array<{ url: string; auth: string | null }> = [];
const siteFetch = (async (u: string | URL, init?: RequestInit) => {
  asked.push({ url: String(u), auth: new Headers(init?.headers).get('authorization') });
  return new Response(JSON.stringify(site));
}) as unknown as typeof fetch;

beforeAll(async () => {
  ({ db } = await testDb());
  process.env.PROVIDER_SHOP = 'live';
  const identify = (req: Request, res: Response, next: NextFunction) => {
    const [id, email] = String(req.header('x-test-user') ?? '').split('|');
    if (!id) return res.status(401).end();
    req.auth = { walletAddress: '', profileUuid: id, email, emails: email ? [email] : [], token: 't' };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/api/command/catalog', commandCatalogRouter({ db: async () => db, token: () => TOKEN }));
  app.use(
    '/api/command',
    commandRouter({
      db: async () => db,
      identify,
      isMember: async () => false,
      mail: async () => undefined,
      adminEmails: () => ['kai@useclear.org', 'second@useclear.org'],
      appUrl: () => 'https://command.test',
      now: () => new Date('2026-10-26T17:00:00Z'),
      revalidate: async () => void pings++,
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  if (envShop == null) delete process.env.PROVIDER_SHOP;
  else process.env.PROVIDER_SHOP = envShop;
});

type Who = { user: string; session?: string };
const call = async (who: Who | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(root + '/api/command' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any, headers: r.headers };
};
const signIn = async (user: string): Promise<Who> => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const act = (who: Who, kind: string, body: unknown) => call(who, 'POST', `/actions/shop/${kind}`, body);
const q = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T & Record<string, unknown>>(sql, p)).rows as T[];
const catalog = (token?: string) => call(null, 'GET', '/catalog', undefined, token ? { authorization: `Bearer ${token}` } : {});
const sync = () => runFeed(db, catalogFeed({ COMMAND_CATALOG_TOKEN: TOKEN, COMMAND_SHOP_CATALOG_URL: 'https://site.test/api/shop/catalog' }, siteFetch));
const edit = (pid: string, extra: Record<string, unknown> = {}) => q(`SELECT name, variant, price_cents FROM command.shop_products WHERE id = $1`, [pid]).then(([p]) => ({ id: pid, name: p.name, variant: p.variant, price: p.price_cents / 100, cost: null, ...extra }));

let kai: Who, second: Who;
beforeAll(async () => {
  kai = await signIn('did:kai|kai@useclear.org');
  second = await signIn('did:second|second@useclear.org');
});

describe('the import', () => {
  test('a site that sends only the summary imports nothing', async () => {
    const summary = { products: site.products.map(({ slug, section, name, kind, category, alsoIn, priceCents, status, variants }) => ({ slug, section, name, kind, category, alsoIn, priceCents, status, colours: [], variants })), moved: {} };
    const f = (async () => new Response(JSON.stringify(summary))) as unknown as typeof fetch;
    expect(await runFeed(db, catalogFeed({}, f))).toBe('ok');
    expect((await feedRows(db)).get('catalog')!.figures).toMatchObject({ imported: 0 });
    expect(await q(`SELECT id FROM command.shop_products WHERE in_catalog`)).toEqual([]);
  });

  test('with the token it asks for the full records, and each product comes into Command’s catalog with its colours and variants', async () => {
    expect(await sync()).toBe('ok');
    expect(asked.at(-1)).toEqual({ url: 'https://site.test/api/shop/catalog?full=1', auth: `Bearer ${TOKEN}` });
    expect((await feedRows(db)).get('catalog')!.figures).toMatchObject({ imported: 4 });
    expect((await q(`SELECT id, status, title, section, kind, weight_oz FROM command.shop_products WHERE in_catalog ORDER BY position`)).map((r) => [r.id, r.status, r.title, r.section, r.kind, Number(r.weight_oz)])).toEqual([
      ['logotee', 'on', 'Logo Tee', 'goods', 'tee', 9],
      ['logopatch', 'on', 'Logo Patch', 'goods', 'patch', 1],
      ['clearpoint', 'on', 'Clear Point', 'for-shops', 'point', 16],
      ['coopcap', 'draft', 'Co-op Cap', 'goods', 'cap', 1],
    ]);
    expect((await q(`SELECT id FROM command.shop_variants WHERE product_id = 'logotee' ORDER BY position`)).map((r) => r.id)).toEqual(['black-s', 'black-m', 'white-s', 'white-m']);
    expect((await q(`SELECT id, swatch FROM command.shop_colours WHERE product_id = 'logotee' ORDER BY position`)).map((r) => [r.id, r.swatch])).toEqual([['black', '#232324'], ['white', '#EDEDEA']]);
    // its stock grid, so a run has somewhere to land, and the moved slug
    expect((await q(`SELECT count(*)::int AS n FROM command.shop_stock WHERE product_id = 'logotee'`))[0].n).toBe(12);
    expect(await q(`SELECT old_slug, new_slug FROM command.shop_moved`)).toEqual([{ old_slug: 'member-tee', new_slug: 'logo-tee' }]);
  });

  test('once a product is Command’s, the site’s copy doesn’t overwrite it; a new one on the site still comes in', async () => {
    site = { ...site, products: [{ ...tee, priceCents: 9900, name: 'Changed on the site' }, patch, point, cap, { ...tee, slug: 'logo-hoodie', name: 'Logo Hoodie', kind: 'hoodie', priceCents: 8800 }] };
    expect(await sync()).toBe('ok');
    expect((await feedRows(db)).get('catalog')!.figures).toMatchObject({ imported: 1 });
    expect((await q(`SELECT title, price_cents FROM command.shop_products WHERE id = 'logotee'`))[0]).toEqual({ title: 'Logo Tee', price_cents: 2700 });
    expect((await q(`SELECT in_catalog FROM command.shop_products WHERE id = 'logohoodie'`))[0].in_catalog).toBe(true);
  });
});

describe('the store’s catalog', () => {
  test('public: what’s on the shelf, in the site’s shape, cached a minute', async () => {
    const r = await catalog();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=60');
    expect(r.body.products.map((p: any) => p.slug)).toEqual(['logo-tee', 'logo-patch', 'clear-point', 'logo-hoodie']);
    expect(r.body.products[0]).toEqual(tee);
    expect(r.body.products[1]).toEqual(patch);
    // hardware: reserved with a deposit, its month and FCC status as a pre-order
    expect(r.body.products[2]).toEqual(point);
    expect(r.body.moved).toEqual({ 'member-tee': 'logo-tee' });
  });

  test('with the token, the drafts too; a wrong token is the public answer', async () => {
    const r = await catalog(TOKEN);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.body.products.map((p: any) => [p.slug, p.status])).toContainEqual(['coop-cap', 'draft']);
    expect((await catalog('nope')).body.products.map((p: any) => p.slug)).not.toContain('coop-cap');
  });
});

describe('editing the catalog', () => {
  test('the store’s fields change at once, logged, with nothing queued for the site', async () => {
    const r = await act(kai, 'product-edit', await edit('logotee', { title: 'Logo Tee, heavyweight', description: 'New words.', details: ['Heavyweight cotton jersey'], weightOz: 10, ships: 'Feb 2027' }));
    expect([r.status, r.body.queued]).toEqual([200, false]);
    const p = (await catalog()).body.products.find((x: any) => x.slug === 'logo-tee');
    expect(p).toMatchObject({ name: 'Logo Tee, heavyweight', description: 'New words.', details: ['Heavyweight cotton jersey'], weightOz: 10, ships: 'Feb 2027', priceCents: 2700 });
    expect(await q(`SELECT 1 FROM command.outbox`)).toEqual([]);
  });

  test('a price change on a live product waits for a second person; on a draft it doesn’t', async () => {
    const r = await act(kai, 'product-edit', await edit('logotee', { price: 30 }));
    expect([r.status, r.body.needs]).toEqual([202, 'a second person']);
    expect(r.body.proposal.summary).toBe('Updated Logo Tee · price $27.00 → $30.00');
    expect((await catalog()).body.products.find((x: any) => x.slug === 'logo-tee').priceCents).toBe(2700);
    expect((await call(second, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(200);
    expect((await catalog()).body.products.find((x: any) => x.slug === 'logo-tee').priceCents).toBe(3000);
    expect((await q(`SELECT what FROM command.shop_history WHERE product_id = 'logotee' ORDER BY id DESC LIMIT 1`))[0].what).toBe('Updated the details · price $27.00 → $30.00');
    // the draft's price changes straight away
    expect((await act(kai, 'product-edit', await edit('coopcap', { price: 34 }))).status).toBe(200);
    expect((await q(`SELECT price_cents FROM command.shop_products WHERE id = 'coopcap'`))[0].price_cents).toBe(3400);
  });

  test('a variant: sold out at once, its deposit with a second person', async () => {
    expect((await act(kai, 'variant-edit', { id: 'logopatch', variant: 'circle', soldOut: false })).status).toBe(200);
    expect((await catalog()).body.products.find((x: any) => x.slug === 'logo-patch').variants[1]).toEqual({ id: 'circle', label: 'Circle' });
    const r = await act(kai, 'variant-edit', { id: 'clearpoint', variant: 'table', deposit: 60 });
    expect(r.status).toBe(202);
    expect((await call(second, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(200);
    expect((await catalog()).body.products.find((x: any) => x.slug === 'clear-point').variants[0]).toMatchObject({ depositCents: 6000, priceCents: 8900 });
    const bad = await act(kai, 'variant-edit', { id: 'clearpoint', variant: 'table', price: 50, deposit: 60 });
    expect(bad.status).toBe(400);
    expect((await act(kai, 'variant-edit', { id: 'clearpoint', variant: 'nope', soldOut: true })).status).toBe(404);
  });

  test('a new slug keeps the old one as moved, and the store finds it by either', async () => {
    expect((await act(kai, 'product-edit', await edit('logotee', { slug: 'logo-tee-heavy' }))).status).toBe(200);
    const r = await catalog();
    expect(r.body.products.map((p: any) => p.slug)).toContain('logo-tee-heavy');
    // the old slug moves on, and one that already pointed at it follows
    expect(r.body.moved).toEqual({ 'logo-tee': 'logo-tee-heavy', 'member-tee': 'logo-tee-heavy' });
    expect((await act(kai, 'product-edit', await edit('logopatch', { slug: 'logo-tee-heavy' }))).status).toBe(409);
  });

  test('off the shelf: gone from the public catalog, a draft with the token, and Shop’s page says off', async () => {
    expect((await act(kai, 'shelf-off', { id: 'logopatch', why: 'Sold out' })).body.queued).toBe(false);
    expect((await catalog()).body.products.map((p: any) => p.slug)).not.toContain('logo-patch');
    expect((await catalog(TOKEN)).body.products.find((p: any) => p.slug === 'logo-patch').status).toBe('draft');
    const s: any = await shopSection(db, { level: SEE, reveal: false, now: new Date('2026-10-26T17:00:00Z') });
    expect(s.PR.find((p: any) => p.id === 'logopatch')).toMatchObject({ st: 'off', slug: 'logo-patch' });
    // archived isn't sent at all
    expect((await act(kai, 'archive', { id: 'coopcap', why: 'Not making it' })).status).toBe(200);
    expect((await catalog(TOKEN)).body.products.map((p: any) => p.slug)).not.toContain('coop-cap');
  });
});

describe('11b: editing the catalog from the app', () => {
  const shop = (): Promise<any> => shopSection(db, { level: SEE, reveal: false, now: new Date('2026-10-26T17:00:00Z') });
  const pub = async (slug: string, token?: string) => (await catalog(token)).body.products.find((p: any) => p.slug === slug);

  test('the Shop page gets each catalog product as the store shows it, with what’s on hand behind each variant', async () => {
    const c = (await shop()).CATALOG;
    expect(c.logotee).toMatchObject({ slug: 'logo-tee-heavy', status: 'live', title: 'Logo Tee, heavyweight', price: 30, weightOz: 10, ships: 'Feb 2027', sellPastStock: true, variantLabel: 'Size' });
    expect(c.logotee.variants[1]).toEqual({ id: 'black-m', label: 'Black · M', colour: 'black', size: 'm', price: null, deposit: null, per: null, soldOut: false, onHand: 0 });
    expect(c.clearpoint).toMatchObject({ section: 'for-shops', fcc: true, ships: 'Feb 2027', founding: point.founding });
    expect(c.clearpoint.variants[0]).toMatchObject({ id: 'table', price: 89, deposit: 60 });
  });

  test('a colour: in each of the garment’s sizes, with its stock; then taken off, unless some is on hand', async () => {
    const before = pings;
    const r = await act(kai, 'colour-add', { id: 'logotee', colour: { id: 'navy', label: 'Navy', swatch: '#252B3B', tone: 'ink' } });
    expect(r.status).toBe(200);
    expect(pings).toBe(before + 1);
    const p = await pub('logo-tee-heavy');
    expect(p.colours.map((c: any) => c.id)).toEqual(['black', 'white', 'navy']);
    expect(p.variants.slice(-2)).toEqual([
      { id: 'navy-s', label: 'Navy · S', colour: 'navy', size: 's' },
      { id: 'navy-m', label: 'Navy · M', colour: 'navy', size: 'm' },
    ]);
    expect((await q(`SELECT count(*)::int AS n FROM command.shop_stock WHERE product_id = 'logotee' AND option = 'Navy'`))[0].n).toBe(6);
    expect((await act(kai, 'colour-add', { id: 'logotee', colour: { id: 'navy2', label: 'navy', swatch: '#252B3B', tone: 'ink' } })).status).toBe(409);
    await db.query(`UPDATE command.shop_stock SET on_hand = 2 WHERE product_id = 'logotee' AND option = 'Navy' AND size = 'M'`);
    const held = await act(kai, 'colour-remove', { id: 'logotee', colour: 'navy' });
    expect([held.status, held.body.error]).toEqual([409, 'Navy still has 2 on hand']);
    await db.query(`UPDATE command.shop_stock SET on_hand = 0 WHERE product_id = 'logotee' AND option = 'Navy'`);
    expect((await act(kai, 'colour-remove', { id: 'logotee', colour: 'navy' })).status).toBe(200);
    expect((await pub('logo-tee-heavy')).variants.map((v: any) => v.id)).toEqual(['black-s', 'black-m', 'white-s', 'white-m']);
    expect(await q(`SELECT 1 FROM command.shop_stock WHERE product_id = 'logotee' AND option = 'Navy'`)).toEqual([]);
    expect((await q(`SELECT options FROM command.shop_products WHERE id = 'logotee'`))[0].options).toEqual(['Black', 'White']);
  });

  test('an option on a product without colours: its price waits for a second person while it’s on the shelf', async () => {
    const r = await act(kai, 'variant-add', { id: 'clearpoint', label: 'Counter', price: 129, deposit: 65 });
    expect(r.status).toBe(202);
    const before = pings;
    expect((await call(second, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(200);
    expect(pings).toBe(before + 1);
    expect((await pub('clear-point')).variants.at(-1)).toEqual({ id: 'counter', label: 'Counter', priceCents: 12900, depositCents: 6500 });
    expect((await act(kai, 'variant-add', { id: 'logotee', label: 'XXL' })).status).toBe(409);
    expect((await act(kai, 'variant-remove', { id: 'logotee', variant: 'black-s' })).status).toBe(409);
    expect((await act(kai, 'variant-remove', { id: 'clearpoint', variant: 'counter' })).status).toBe(200);
    expect((await pub('clear-point')).variants.map((v: any) => v.id)).toEqual(['table', 'ten']);
    // one off the shelf takes a new option at once
    expect((await act(kai, 'variant-add', { id: 'logopatch', label: 'Oval', price: 10 })).status).toBe(200);
  });

  test('stopping at what’s on hand: a colour and size with none shows sold out on the store', async () => {
    expect((await act(kai, 'product-edit', await edit('logotee', { sellPastStock: false }))).status).toBe(200);
    await db.query(`UPDATE command.shop_stock SET on_hand = 3 WHERE product_id = 'logotee' AND option = 'Black' AND size = 'S'`);
    const p = await pub('logo-tee-heavy');
    expect(p.variants.map((v: any) => [v.id, !!v.soldOut])).toEqual([['black-s', false], ['black-m', true], ['white-s', true], ['white-m', true]]);
    expect((await shop()).CATALOG.logotee.variants[0]).toMatchObject({ onHand: 3, soldOut: false });
    expect((await act(kai, 'product-edit', await edit('logotee', { sellPastStock: true }))).status).toBe(200);
    expect((await pub('logo-tee-heavy')).variants.some((v: any) => v.soldOut)).toBe(false);
  });

  test('a new product goes into the catalog as a draft, in colours and sizes, with its stock and shelf', async () => {
    const r = await act(kai, 'catalog-add', {
      title: 'Logo Crewneck', slug: 'logo-crewneck', section: 'goods', kind: 'hoodie', category: 'Wear', alsoIn: ['Logo'], tagline: 'A heavy crewneck.', description: 'Fleece, patch on the chest.',
      details: ['Heavy fleece'], price: 72, variantLabel: 'Size', colours: [{ id: 'black', label: 'Black', swatch: '#232324', tone: 'ink' }], sizes: ['s', 'm', 'l'], weightOz: 22, ships: 'Mar 2027',
    });
    expect(r.status).toBe(200);
    expect(r.body.result.id).toBe('logocrewneck');
    expect(await pub('logo-crewneck')).toBeUndefined();
    expect(await pub('logo-crewneck', TOKEN)).toMatchObject({ status: 'draft', name: 'Logo Crewneck', priceCents: 7200, ships: 'Mar 2027', variants: [{ id: 'black-s' }, { id: 'black-m' }, { id: 'black-l' }] });
    expect((await q(`SELECT count(*)::int AS n FROM command.shop_stock WHERE product_id = 'logocrewneck'`))[0].n).toBe(6);
    expect((await shop()).PR.find((p: any) => p.id === 'logocrewneck')).toMatchObject({ st: 'draft', slug: 'logo-crewneck' });
    expect((await act(kai, 'catalog-add', { title: 'Again', slug: 'logo-crewneck', section: 'goods', kind: 'tee', category: 'Wear', price: 10, weightOz: 5 })).status).toBe(409);
    // hardware: one size, reserved with a deposit
    const hw = await act(kai, 'catalog-add', { title: 'Clear Kiosk', slug: 'clear-kiosk', section: 'for-shops', kind: 'kit', category: 'For shops', price: 400, deposit: 100, weightOz: 80, ships: 'Jun 2027' });
    expect(hw.status).toBe(200);
    expect(await pub('clear-kiosk', TOKEN)).toMatchObject({ preorder: { ships: 'Jun 2027', fcc: false }, variants: [{ id: 'one-size', label: 'One size', depositCents: 10000 }] });
  });
});

describe('telling the site', () => {
  test('a POST with the token to COMMAND_SITE_REVALIDATE_URL; nothing without it, and a failure isn’t thrown', async () => {
    const sent: Array<{ url: string; method?: string; auth: string | null }> = [];
    const f = (async (u: string, init?: RequestInit) => {
      sent.push({ url: String(u), method: init?.method, auth: new Headers(init?.headers).get('authorization') });
      return new Response('{}');
    }) as unknown as typeof fetch;
    expect(await revalidateSite({ COMMAND_SITE_REVALIDATE_URL: 'https://site.test/api/shop/revalidate', COMMAND_CATALOG_TOKEN: TOKEN }, f)).toBe(true);
    expect(sent).toEqual([{ url: 'https://site.test/api/shop/revalidate', method: 'POST', auth: `Bearer ${TOKEN}` }]);
    expect(await revalidateSite({ COMMAND_CATALOG_TOKEN: TOKEN }, f)).toBe(false);
    const down = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await revalidateSite({ COMMAND_SITE_REVALIDATE_URL: 'https://site.test/x', COMMAND_CATALOG_TOKEN: TOKEN }, down)).toBe(false);
  });
});
