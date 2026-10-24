import { beforeAll, describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { commandWebhookRouter } from '../../routes/command.js';
import { bridgeFeed, lithicFeed, plaidFeed, plaidWebhook, stripeFeed } from './feedSources.js';
import { due, feedRows, feedStatus, requestSync, runFeed, statusLine, type Feed, type FeedStatus } from './feeds.js';

/*
 * Phase 6a: the sandbox feeds against stand-in providers. Each refuses anything but a sandbox, syncs
 * on its schedule or when asked, and the menu's line names the worst of them. Plaid's link is made
 * once and its token kept encrypted; its webhook is believed only with Plaid's signature.
 */

process.env.PLAID_TOKEN_MASTER_KEY ||= randomBytes(32).toString('base64');

/** A stand-in provider: answers by path, and remembers what it was asked. */
function stand(routes: Record<string, (body: any, url: URL) => unknown>) {
  const asked: Array<{ path: string; body: any }> = [];
  const f = (async (u: string | URL, init?: RequestInit) => {
    const url = new URL(String(u));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    asked.push({ path: url.pathname, body });
    const route = Object.keys(routes).find((k) => url.pathname.endsWith(k));
    if (!route) return new Response(JSON.stringify({ error_code: 'NOT_FOUND' }), { status: 404 });
    const out = routes[route](body, url);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, asked };
}

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

describe('only sandboxes', () => {
  test('each feed refuses keys that aren’t a sandbox’s, and says why', () => {
    expect(plaidFeed({ PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's', PLAID_ENV: 'production' }).off()).toBe('PLAID_ENV is production, not sandbox');
    expect(plaidFeed({ PLAID_ENV: 'sandbox' }).off()).toMatch(/aren’t set/);
    expect(bridgeFeed({ BRIDGE_SANDBOX_API_KEY: 'k' }).off()).toBe('BRIDGE_ENV is unset, not sandbox');
    expect(lithicFeed({ LITHIC_API_KEY: 'k', LITHIC_ENV: 'production' }).off()).toBe('LITHIC_ENV is production, not sandbox');
    expect(stripeFeed({ STRIPE_SECRET_KEY: 'sk_live_x' }).off()).toBe('the Stripe key isn’t a test key');
    expect(stripeFeed({ STRIPE_SECRET_KEY: 'rk_test_x' }).off()).toBeNull();
    expect(plaidFeed({ PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's', PLAID_ENV: 'sandbox' }).off()).toBeNull();
  });

  test('a feed that’s off is recorded off, and never asked anything', async () => {
    const s = stand({});
    expect(await runFeed(db, stripeFeed({ STRIPE_SECRET_KEY: 'sk_live_x' }, s.f))).toBe('off');
    expect(s.asked).toHaveLength(0);
    expect((await feedRows(db)).get('stripe')).toMatchObject({ state: 'off', off_reason: 'the Stripe key isn’t a test key' });
  });
});

describe('Plaid', () => {
  const env = { PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's', PLAID_ENV: 'sandbox', COMMAND_PLAID_WEBHOOK_URL: 'https://api.test/api/command/webhooks/plaid' };
  let pages: any[] = [];
  const s = stand({
    '/sandbox/public_token/create': () => ({ public_token: 'public-sandbox-1' }),
    '/item/public_token/exchange': () => ({ access_token: 'access-sandbox-SECRET', item_id: 'item-1' }),
    '/transactions/sync': () => pages.shift() ?? { added: [], modified: [], removed: [], next_cursor: 'c-end', has_more: false },
    '/accounts/get': () => ({
      accounts: [
        { account_id: 'a1', name: 'Plaid Checking', mask: '0000', type: 'depository', subtype: 'checking', balances: { current: 110, available: 100 } },
        { account_id: 'a2', name: 'Plaid Credit Card', mask: '3333', type: 'credit', subtype: 'credit card', balances: { current: 410, available: null } },
      ],
    }),
    '/item/get': () => ({ item: { institution_id: 'ins_109508' }, status: { transactions: { last_successful_update: '2026-10-24T03:00:00Z' } } }),
  });
  const t = (id: string, amount: number) => ({ transaction_id: id, account_id: 'a1', date: '2026-10-23', name: `T ${id}`, merchant_name: null, amount, pending: false });

  test('the first sync makes the co-op’s sandbox link, keeps its token encrypted, and reads the bank', async () => {
    pages = [
      { added: [t('t1', 12.5), t('t2', -500)], modified: [], removed: [], next_cursor: 'c1', has_more: true },
      { added: [t('t3', 4)], modified: [], removed: [], next_cursor: 'c2', has_more: false },
    ];
    const feed = plaidFeed(env, s.f);
    expect(await runFeed(db, feed)).toBe('ok');
    const made = s.asked.find((a) => a.path.endsWith('/sandbox/public_token/create'))!;
    expect(made.body).toMatchObject({ institution_id: 'ins_109508', initial_products: ['transactions'], options: { webhook: env.COMMAND_PLAID_WEBHOOK_URL } });
    const { rows } = await db.query<any>('SELECT item_id, access_token::text AS tok, sync_cursor FROM command.plaid_items');
    expect(rows).toHaveLength(1);
    expect(rows[0].tok).not.toContain('access-sandbox-SECRET');
    expect(rows[0].sync_cursor).toBe('c2');
    const r = (await feedRows(db)).get('plaid')!;
    // only the depository accounts make up the bank balance; the freshness is Plaid's own
    expect(r.figures.balance).toBe(110);
    expect(new Date(r.as_of!).toISOString()).toBe('2026-10-24T03:00:00.000Z');
    expect((await db.query('SELECT id FROM command.bank_transactions ORDER BY id')).rows.map((x: any) => x.id)).toEqual(['t1', 't2', 't3']);
  });

  test('the next sync reuses the link, from its cursor; modified and removed are kept to', async () => {
    s.asked.length = 0;
    pages = [{ added: [], modified: [t('t1', 13)], removed: [{ transaction_id: 't2' }], next_cursor: 'c3', has_more: false }];
    expect(await runFeed(db, plaidFeed(env, s.f))).toBe('ok');
    expect((await feedRows(db)).get('plaid')!.error).toBeNull();
    expect(s.asked.some((a) => a.path.endsWith('/public_token/create'))).toBe(false);
    expect(s.asked.find((a) => a.path.endsWith('/transactions/sync'))!.body).toMatchObject({ access_token: 'access-sandbox-SECRET', cursor: 'c2' });
    const { rows } = await db.query<any>('SELECT id, amount FROM command.bank_transactions ORDER BY id');
    expect(rows.map((x) => [x.id, Number(x.amount)])).toEqual([
      ['t1', 13],
      ['t3', 4],
    ]);
  });

  test('a link too new for transactions still gives its balances', async () => {
    pages = [new Response(JSON.stringify({ error_code: 'PRODUCT_NOT_READY', error_message: 'not yet' }), { status: 400 }) as any];
    expect(await runFeed(db, plaidFeed(env, s.f))).toBe('ok');
  });

  describe('its webhook', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256', use: 'sig', expired_at: null };
    const keyFor = async (kid: string) => {
      if (kid !== 'k1') throw new Error('no such key');
      return jwk;
    };
    const signed = (body: string, iat = Math.floor(Date.now() / 1000), kid = 'k1') => {
      const h = Buffer.from(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' })).toString('base64url');
      const p = Buffer.from(JSON.stringify({ iat, request_body_sha256: createHash('sha256').update(body).digest('hex') })).toString('base64url');
      const sig = sign('sha256', Buffer.from(`${h}.${p}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return `${h}.${p}.${sig}`;
    };
    const news = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-1' });

    test('signed by Plaid, for the co-op’s link: the bank syncs at the next tick', async () => {
      expect(await plaidWebhook(db, signed(news), Buffer.from(news), keyFor)).toEqual({ ok: true, ours: true, wake: true });
      const other = JSON.stringify({ webhook_type: 'TRANSACTIONS', item_id: 'someone-else' });
      expect(await plaidWebhook(db, signed(other), Buffer.from(other), keyFor)).toEqual({ ok: true, ours: false, wake: false });
    });

    test('anything else is refused: no signature, a changed body, an old one, a forged one', async () => {
      expect(await plaidWebhook(db, undefined, Buffer.from(news), keyFor)).toEqual({ ok: false, why: 'no Plaid-Verification header' });
      expect(await plaidWebhook(db, signed(news), Buffer.from(news.replace('item-1', 'item-2')), keyFor)).toEqual({ ok: false, why: 'body changed' });
      expect(await plaidWebhook(db, signed(news, Math.floor(Date.now() / 1000) - 600), Buffer.from(news), keyFor)).toEqual({ ok: false, why: 'stale' });
      const forged = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
      expect(await plaidWebhook(db, signed(news), Buffer.from(news), async () => ({ ...forged, expired_at: null }))).toEqual({ ok: false, why: 'bad signature' });
    });

    test('the route: a good one asks for a Plaid sync, a bad one is a 400', async () => {
      const app = express();
      app.use(express.json({ verify: (req, _res, buf) => ((req as any).rawBody = Buffer.from(buf)) }));
      app.use('/w', commandWebhookRouter({ db: async () => db, plaidKey: keyFor }));
      const server = app.listen(0);
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/w/plaid`;
      await db.query(`UPDATE command.feeds SET requested_at = NULL, requested_by = NULL WHERE id = 'plaid'`);
      const bad = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'plaid-verification': signed('{}') }, body: news });
      expect(bad.status).toBe(400);
      expect((await feedRows(db)).get('plaid')!.requested_at).toBeNull();
      const good = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'plaid-verification': signed(news) }, body: news });
      expect(good.status).toBe(200);
      expect((await feedRows(db)).get('plaid')).toMatchObject({ requested_by: 'Plaid webhook' });
      server.close();
    });
  });
});

describe('Stripe, Lithic and Bridge', () => {
  test('Stripe: its balance and payouts; a payout that landed since the bank was read wakes Plaid', async () => {
    await db.query(`UPDATE command.feeds SET requested_at = NULL, requested_by = NULL, synced_at = now() - interval '2 hours' WHERE id = 'plaid'`);
    const landed = Math.floor(Date.now() / 1000) - 3600;
    const s = stand({
      '/v1/balance': () => ({ available: [{ currency: 'usd', amount: 125_00 }], pending: [{ currency: 'usd', amount: 40_50 }, { currency: 'eur', amount: 999 }] }),
      '/v1/payouts': () => ({ data: [{ id: 'po_1', amount: 1218_40, arrival_date: landed, status: 'paid' }] }),
    });
    expect(await runFeed(db, stripeFeed({ STRIPE_SECRET_KEY: 'sk_test_x' }, s.f))).toBe('ok');
    expect((await feedRows(db)).get('stripe')!.figures).toMatchObject({ available: 125, pending: 40.5, payouts: [{ id: 'po_1', amount: 1218.4, status: 'paid' }] });
    expect((await feedRows(db)).get('plaid')).toMatchObject({ requested_by: 'stripe' });
  });

  test('Lithic: this month’s spend by merchant, declines and voids left out', async () => {
    const tx = (status: string, descriptor: string, amount: number) => ({ token: `${descriptor}-${amount}`, status, merchant: { descriptor }, amount, settled_amount: status === 'SETTLED' ? amount : 0 });
    const s = stand({
      '/v1/transactions': (_b, url) => {
        expect(url.searchParams.get('begin')).toBe('2026-10-01T00:00:00Z');
        return url.searchParams.get('starting_after')
          ? { data: [tx('PENDING', 'Cajon Phone Repair', 2000)], has_more: false }
          : { data: [tx('SETTLED', 'Rosa’s Tacos', 1250), tx('SETTLED', 'Rosa’s Tacos', 750), tx('DECLINED', 'Rosa’s Tacos', 9999), tx('VOIDED', 'X', 1)], has_more: true };
      },
    });
    expect(await runFeed(db, lithicFeed({ LITHIC_API_KEY: 'k' }, s.f, () => new Date('2026-10-24T12:00:00Z')))).toBe('ok');
    expect((await feedRows(db)).get('lithic')!.figures).toEqual({
      month: '2026-10',
      spent: 40,
      count: 3,
      declined: 1,
      merchants: [
        { name: 'Cajon Phone Repair', amount: 20, count: 1 },
        { name: 'Rosa’s Tacos', amount: 20, count: 2 },
      ],
    });
  });

  test('Bridge: an account with no wallets is none, not a failure; transfers still moving are counted', async () => {
    const s = stand({ '/v0/transfers': () => ({ data: [{ state: 'awaiting_funds', amount: '50.00' }, { state: 'payment_processed', amount: '20' }, { state: 'funds_received', amount: '10' }] }) });
    expect(await runFeed(db, bridgeFeed({ BRIDGE_ENV: 'sandbox', BRIDGE_SANDBOX_API_KEY: 'k' }, s.f))).toBe('ok');
    expect((await feedRows(db)).get('bridge')!.figures).toEqual({ wallets: [], usdc: 0, inFlight: { count: 2, amount: 60 }, transfers: 3 });
  });

  test('a provider that fails is recorded failing, with its answer', async () => {
    const s = stand({ '/v1/balance': () => new Response('{"error":{"message":"Invalid API Key"}}', { status: 401 }), '/v1/payouts': () => ({ data: [] }) });
    expect(await runFeed(db, stripeFeed({ STRIPE_SECRET_KEY: 'sk_test_x' }, s.f))).toBe('error');
    expect((await feedRows(db)).get('stripe')).toMatchObject({ state: 'error', error: expect.stringContaining('Stripe /balance 401') });
  });
});

describe('when each runs', () => {
  const f = (id: any, everyMs: number): Feed => ({ id, everyMs, off: () => null, sync: async () => ({ figures: null }) });
  const row = (over: any) => ({ id: 'lithic', state: 'ok', off_reason: null, synced_at: null, tried_at: null, as_of: null, error: null, figures: null, requested_at: null, requested_by: null, ...over });
  const now = Date.parse('2026-10-24T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms);

  test('on its schedule, when asked (never twice a minute), and a failed one after a tenth of its schedule', () => {
    const feeds = [f('lithic', 300_000), f('plaid', 86_400_000)];
    const at = (l: any, p: any) => due(feeds, new Map([['lithic', row(l)], ['plaid', row({ id: 'plaid', ...p })]]) as any, now).map((x) => x.id);
    expect(at({ synced_at: ago(299_000) }, { synced_at: ago(3600e3) })).toEqual([]);
    expect(at({ synced_at: ago(300_000) }, { synced_at: ago(86_400_000) })).toEqual(['lithic', 'plaid']);
    expect(at({ synced_at: ago(10_000) }, { synced_at: ago(3600e3), requested_at: ago(1000), tried_at: ago(3600e3) })).toEqual(['plaid']);
    expect(at({ synced_at: ago(10_000) }, { synced_at: ago(3600e3), requested_at: ago(1000), tried_at: ago(30_000) })).toEqual([]);
    expect(at({ state: 'error', tried_at: ago(59_000) }, { state: 'error', synced_at: ago(3600e3), tried_at: ago(2 * 3600e3) })).toEqual([]);
    expect(at({ state: 'error', tried_at: ago(60_000) }, { state: 'error', synced_at: ago(3600e3), tried_at: ago(9000e3) })).toEqual(['lithic', 'plaid']);
    expect(at({ state: 'never' }, { state: 'never' })).toEqual(['lithic', 'plaid']);
  });

  test('Sync now asks once, however often it’s pressed', async () => {
    await db.query(`UPDATE command.feeds SET requested_at = NULL, requested_by = NULL WHERE id = 'bridge'`);
    await requestSync(db, 'bridge', 'Kai');
    await requestSync(db, 'bridge', 'Dana');
    expect((await feedRows(db)).get('bridge')).toMatchObject({ requested_by: 'Kai' });
  });
});

describe('the menu’s line', () => {
  const s = (id: any, health: FeedStatus['health'], behindMs: number | null = 0): FeedStatus => ({ id, name: id[0].toUpperCase() + id.slice(1), health, behindMs, syncedAt: 0, asOf: 0, error: null, offReason: null });

  test('the worst feed first, then the others', () => {
    expect(statusLine([s('plaid', 'behind', 3 * 3600e3), s('bridge', 'synced'), s('lithic', 'synced'), s('stripe', 'synced')])).toEqual({ headline: 'Plaid is 3h behind', rest: '3 other feeds synced', worst: 'plaid' });
    expect(statusLine([s('plaid', 'synced'), s('bridge', 'failing', null), s('lithic', 'behind', 900_000), s('stripe', 'off')])).toEqual({ headline: 'Bridge isn’t syncing', rest: '1 of 2 other feeds synced', worst: 'bridge' });
    expect(statusLine([s('plaid', 'synced'), s('bridge', 'synced'), s('stripe', 'off')])).toEqual({ headline: 'Every feed synced', rest: '2 feeds', worst: null });
    expect(statusLine([s('plaid', 'off')])).toEqual({ headline: 'No feeds yet', rest: '1 off', worst: null });
  });

  test('each feed’s health from its row: behind once older than twice its schedule; the chain from the indexer', async () => {
    const now = Date.now();
    await db.query(`UPDATE command.feeds SET state = 'ok', error = NULL, as_of = $1, synced_at = $1 WHERE id = 'plaid'`, [new Date(now - 49 * 3600e3)]);
    await db.query(`UPDATE command.feeds SET state = 'ok', error = NULL, as_of = $1, synced_at = $1 WHERE id = 'lithic'`, [new Date(now - 60_000)]);
    await db.query(`UPDATE command.feeds SET state = 'never', as_of = NULL WHERE id = 'bridge'`);
    await db.query(`INSERT INTO command.chain_cursor (chain_id, indexed_to, head, ran_at) VALUES (84532, 1000, 1005, $1) ON CONFLICT (chain_id) DO UPDATE SET indexed_to = 1000, head = 1005, ran_at = $1, error = NULL`, [new Date(now - 120_000)]);
    const feeds = [plaidFeed({ PLAID_ENV: 'sandbox' }), bridgeFeed({}), lithicFeed({ LITHIC_API_KEY: 'k' }), stripeFeed({ STRIPE_SECRET_KEY: 'sk_live_x' })];
    const st = await feedStatus(db, feeds, now);
    const by = Object.fromEntries(st.feeds.map((x) => [x.id, x.health]));
    expect(by).toEqual({ plaid: 'behind', bridge: 'never', lithic: 'synced', stripe: 'failing', protocol: 'synced' });
    expect(st.feeds.find((x) => x.id === 'protocol')!.behindMs).toBe(120_000 + 5 * 2000);
    expect(st.line.worst).toBe('stripe');
  });
});
