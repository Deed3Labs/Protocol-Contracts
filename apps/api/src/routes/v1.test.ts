import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Stripe from 'stripe';
import { ENDPOINTS, Event, Payment, Refund, WebhookDelivery } from '@clear/public-api-contracts';
import type { Db } from '../db/db.js';
import { seedShop, testDb } from '../db/testDb.js';
import * as catalog from '../services/merchant/catalog/catalogService.js';
import { connectorStore } from '../services/merchant/cards/connectorStore.js';
import { fakeProvider } from '../services/merchant/cards/fakeProvider.js';
import type { OrderDeps } from '../services/merchant/orders/orderService.js';
import type { ClearCharges } from '../services/merchant/orders/payments.js';
import { createCheckoutTender as checkoutTender } from '../services/merchant/cards/cardTenders.js';
import { createClearTender, syncClearTender } from '../services/merchant/orders/payments.js';
import { addSite, createKeys, rollSecretKey } from '../services/merchant/pay/keys.js';
import { deliverDue, nextAttempt, RETRY_FOR_MS } from '../services/merchant/pay/webhooks.js';
import { cardPaymentHandlers } from '../services/merchant/stripeEvents/cardPaymentHandlers.js';
import { v1Cors, v1Errors, v1Router } from './v1.js';

/**
 * Pay with Clear's public API (pay prompt, Phase 4), over HTTP with the server SDK as the client:
 * keys and versions, idempotency, the publishable key's limits, test and live apart, refunds, and
 * signed webhooks the SDK verifies.
 */

// The server SDK, from its workspace source: the tests drive /v1 the way a shop's server will. Loaded
// by path, since the API doesn't depend on it (its image doesn't carry the package).
const SDK_PATH = '../../../../packages/clear-node/src/index.ts';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sdk = any;
const { default: Clear, ClearError } = (await import(SDK_PATH)) as { default: new (key: string, options: object) => Sdk; ClearError: new (...a: unknown[]) => Error };

/** An error answer's body. */
type ErrorBody = { error: { type: string; code: string; message: string; param?: string } };
const body = async <T = ErrorBody>(res: Response) => (await res.json()) as T;

let db: Db;
let server: Server;
let base: string;
const orders: OrderDeps = { taxApi: null, pinCheck: async () => null };
const fake = fakeProvider();
let clock = new Date('2026-10-16T17:40:00Z');
const pass: express.RequestHandler = (_req, _res, next) => next();

beforeAll(async () => {
  ({ db } = await testDb());
  const app = express();
  app.use('/v1', v1Cors);
  app.use(express.json());
  app.use('/v1', v1Router({ db: async () => db, v1: () => ({ orders, refunds: async () => ({ card: fake.provider, pinCheck: async () => null }) }), limit: pass, now: () => clock }));
  app.use('/v1', v1Errors);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

let seq = 0;
const key = (p = 'k') => `${p}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

/** Mi Casa Tacos with keys in both modes, micasatacos.com allowed, and (optionally) cards connected. */
async function shop(opts: { cards?: boolean } = {}) {
  const s = await seedShop(db);
  await db.query(`UPDATE merchant.profiles SET name = 'Mi Casa Tacos', timezone = 'America/Los_Angeles' WHERE merchant = $1`, [s.merchant]);
  const live = await createKeys(db, { merchant: s.merchant, staffId: s.staff.owner, livemode: true });
  const test = await createKeys(db, { merchant: s.merchant, staffId: s.staff.owner, livemode: false });
  const { rows } = await db.query<{ token: string; livemode: boolean }>(`SELECT token, livemode FROM payments.api_keys WHERE merchant = $1 AND kind = 'publishable'`, [s.merchant]);
  await addSite(db, { merchant: s.merchant, staffId: s.staff.owner, request: { site: 'micasatacos.com' } });
  await addSite(db, { merchant: s.merchant, staffId: s.staff.owner, request: { site: 'http://localhost:3000' } });
  if (opts.cards) {
    const acct = `acct_${s.merchant.slice(-8)}`;
    await connectorStore.insert(db, { merchant: s.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: s.staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
  }
  const tray = await catalog.createItem(db, { merchant: s.merchant, staffId: s.staff.owner, item: { name: 'Taco tray for 12', detail: null, category: 'Catering', priceCents: 14900, costCents: null, taxKind: 'food', stockTracked: false, reorderAt: null } });
  return {
    ...s,
    tray,
    liveSecret: live.secret,
    testSecret: test.secret,
    livePk: rows.find((r) => r.livemode)!.token,
    testPk: rows.find((r) => !r.livemode)!.token,
    sdk: (secret: string, webhookSecret?: string) => new Clear(secret, { baseUrl: base, webhookSecret, maxRetries: 0 }),
  };
}

const call = (path: string, init: { method?: string; key: string; body?: unknown; headers?: Record<string, string> }) =>
  fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${init.key}`, 'Content-Type': 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

/** The spec's server snippet (§1), word for word. */
const SNIPPET = {
  amount: 18532,
  currency: 'usd' as const,
  reference: 'catering-1042',
  lines: [
    { name: 'Taco tray for 12', amount: 14900 },
    { name: 'Agua fresca, gallon', amount: 1100, quantity: 2 },
  ],
};

describe('the spec’s server snippet', () => {
  test('makes a $185.32 payment: the lines, $14.32 tax, a client secret, waiting for the customer', async () => {
    const s = await shop();
    const clear = s.sdk(s.liveSecret);
    const payment = await clear.payments.create(SNIPPET, { idempotencyKey: 'catering-1042' });
    expect(Payment.parse(payment)).toMatchObject({ amount: 18532, reference: 'catering-1042', status: 'requires_customer', method: null, livemode: true, methods: ['clear'] });
    expect(payment.lines).toEqual([
      { name: 'Taco tray for 12', amount: 14900, quantity: 1 },
      { name: 'Agua fresca, gallon', amount: 1100, quantity: 2 },
    ]);
    expect(payment.clientSecret).toMatch(new RegExp(`^${payment.id}_secret_`));
    const { rows } = await db.query<{ total_cents: string; tax_cents: string; source: string; raised_by: string | null }>(
      'SELECT o.total_cents, o.tax_cents, o.source, o.raised_by FROM commerce.orders o JOIN payments.api_payments p ON p.order_id = o.id WHERE p.id = $1',
      [payment.id],
    );
    expect(rows[0]).toMatchObject({ source: 'online', raised_by: null });
    expect([Number(rows[0]!.total_cents), Number(rows[0]!.tax_cents)]).toEqual([18532, 1432]);
    // Read back with the secret key: the same, with its secret.
    expect(await clear.payments.retrieve(payment.id)).toEqual(payment);
  });

  test('card is offered once the shop’s card processor is connected', async () => {
    const s = await shop({ cards: true });
    expect((await s.sdk(s.liveSecret).payments.create(SNIPPET, { idempotencyKey: key() })).methods).toEqual(['clear', 'card']);
  });
});

describe('idempotency', () => {
  test('the same key and body is the same payment; another body with that key is refused', async () => {
    const s = await shop();
    const clear = s.sdk(s.liveSecret);
    const k = key();
    const a = await clear.payments.create({ ...SNIPPET, reference: 'r-1' }, { idempotencyKey: k });
    const b = await clear.payments.create({ ...SNIPPET, reference: 'r-1' }, { idempotencyKey: k });
    expect(b.id).toBe(a.id);
    await expect(clear.payments.create({ ...SNIPPET, reference: 'r-1', amount: 18600 }, { idempotencyKey: k })).rejects.toMatchObject({ code: 'idempotency_key_reused', status: 409 });
  });

  test('a payment needs an Idempotency-Key', async () => {
    const s = await shop();
    const res = await call('/v1/payments', { method: 'POST', key: s.liveSecret, body: SNIPPET });
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatchObject({ type: 'invalid_request', code: 'idempotency_key_required' });
  });

  test('a reference is the shop’s own, once per mode', async () => {
    const s = await shop();
    await s.sdk(s.liveSecret).payments.create({ ...SNIPPET, reference: 'r-2' }, { idempotencyKey: key() });
    await expect(s.sdk(s.liveSecret).payments.create({ ...SNIPPET, reference: 'r-2' }, { idempotencyKey: key() })).rejects.toMatchObject({ code: 'reference_taken', param: 'reference' });
    // The test mode's references are its own.
    expect((await s.sdk(s.testSecret).payments.create({ ...SNIPPET, reference: 'r-2' }, { idempotencyKey: key() })).livemode).toBe(false);
  });
});

describe('Clear-Version', () => {
  test('missing: the key’s pinned version, said in the answer', async () => {
    const s = await shop();
    const res = await call('/v1/prices', { key: s.liveSecret });
    expect(res.status).toBe(200);
    expect(res.headers.get('clear-version')).toBe('2026-10-16');
  });
  test('known: used', async () => {
    const s = await shop();
    expect((await call('/v1/prices', { key: s.liveSecret, headers: { 'Clear-Version': '2026-10-16' } })).status).toBe(200);
  });
  test('unknown: refused, never rounded', async () => {
    const s = await shop();
    const res = await call('/v1/prices', { key: s.liveSecret, headers: { 'Clear-Version': '2027-01-01' } });
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatchObject({ code: 'version_unknown' });
  });
});

describe('keys', () => {
  test('no key, or not a key: 401', async () => {
    expect((await fetch(`${base}/v1/prices`)).status).toBe(401);
    const res = await call('/v1/prices', { key: ['clear', 'sk', 'live', 'NotARealKeyNotARealKeyXX'].join('_') });
    expect((await body(res)).error).toMatchObject({ type: 'authentication', code: 'key_invalid' });
  });

  test('a rolled secret key works for 24 hours, then stops', async () => {
    const s = await shop();
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM payments.api_keys WHERE merchant = $1 AND kind = 'secret' AND livemode AND rolled_at IS NULL`, [s.merchant]);
    const rolled = await rollSecretKey(db, { merchant: s.merchant, staffId: s.staff.owner, keyId: rows[0]!.id, now: clock });
    expect((await call('/v1/prices', { key: s.liveSecret })).status).toBe(200);
    expect((await call('/v1/prices', { key: rolled.secret })).status).toBe(200);
    clock = new Date(clock.getTime() + 24 * 3600_000 + 1000);
    try {
      expect((await body(await call('/v1/prices', { key: s.liveSecret }))).error.code).toBe('key_expired');
      expect((await call('/v1/prices', { key: rolled.secret })).status).toBe(200);
    } finally {
      clock = new Date('2026-10-16T17:40:00Z');
    }
  });
});

describe('the publishable key', () => {
  test('can’t make a payment', async () => {
    const s = await shop();
    const res = await call('/v1/payments', { method: 'POST', key: s.livePk, body: SNIPPET, headers: { 'Idempotency-Key': key() } });
    expect(res.status).toBe(403);
    expect((await body(res)).error).toMatchObject({ type: 'permission', code: 'publishable_key_not_allowed' });
  });

  test('reads prices: the taco tray is price_…, $149.00', async () => {
    const s = await shop();
    const res = await call('/v1/prices', { key: s.livePk });
    const { data } = await body<{ data: unknown[] }>(res);
    expect(data).toContainEqual({ id: `price_${s.tray.id.replace(/^itm_/, '').replace(/[^A-Za-z0-9]/g, '')}`, object: 'price', name: 'Taco tray for 12', amount: 14900, active: true, allowQuantity: true });
  });

  test('opens a modal only from an allowed website', async () => {
    const s = await shop();
    const price = `price_${s.tray.id.replace(/^itm_/, '').replace(/[^A-Za-z0-9]/g, '')}`;
    const from = (origin: string | null, pk = s.livePk) => call('/v1/modal_sessions', { method: 'POST', key: pk, body: { price, quantity: 1 }, headers: origin ? { Origin: origin } : {} });
    const ok = await from('https://micasatacos.com');
    expect(ok.status).toBe(200);
    expect(await body<object>(ok)).toMatchObject({ object: 'modal_session', livemode: true, url: expect.stringMatching(/^https:\/\/pay\.useclear\.org\/m\/ms_/) });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://micasatacos.com');
    for (const bad of ['https://evil.example', null]) {
      const res = await from(bad);
      expect(res.status).toBe(403);
      expect((await body(res)).error.code).toBe('origin_not_allowed');
    }
    // localhost is for test keys only.
    expect((await from('http://localhost:3000')).status).toBe(403);
    expect((await from('http://localhost:3000', s.testPk)).status).toBe(200);
  });

  test('a modal for a payment takes its client secret, never an amount', async () => {
    const s = await shop();
    const payment = await s.sdk(s.liveSecret).payments.create(SNIPPET, { idempotencyKey: key() });
    const ok = await call('/v1/modal_sessions', { method: 'POST', key: s.livePk, body: { payment: payment.clientSecret }, headers: { Origin: 'https://micasatacos.com' } });
    expect(ok.status).toBe(200);
    const withAmount = await call('/v1/modal_sessions', { method: 'POST', key: s.livePk, body: { payment: payment.clientSecret, amount: 1 }, headers: { Origin: 'https://micasatacos.com' } });
    expect((await body(withAmount)).error).toMatchObject({ code: 'parameter_unknown' });
  });
});

describe('test and live never mix', () => {
  test('a test payment can’t be read, listed or refunded with a live key, nor the reverse', async () => {
    const s = await shop();
    const testPayment = await s.sdk(s.testSecret).payments.create(SNIPPET, { idempotencyKey: key() });
    const livePayment = await s.sdk(s.liveSecret).payments.create(SNIPPET, { idempotencyKey: key() });
    expect(testPayment.livemode).toBe(false);
    await expect(s.sdk(s.liveSecret).payments.retrieve(testPayment.id)).rejects.toMatchObject({ code: 'payment_not_found', status: 404 });
    await expect(s.sdk(s.testSecret).payments.retrieve(livePayment.id)).rejects.toMatchObject({ code: 'payment_not_found' });
    expect((await s.sdk(s.liveSecret).payments.list()).data.map((p: { id: string }) => p.id)).toEqual([livePayment.id]);
    const { rows } = await db.query<{ livemode: boolean }>('SELECT o.livemode FROM commerce.orders o JOIN payments.api_payments p ON p.order_id = o.id WHERE p.id = $1', [testPayment.id]);
    expect(rows[0]!.livemode).toBe(false);
  });
});

/** Pays an API payment with Clear, as the member's approval would. */
async function payWithClear(s: Awaited<ReturnType<typeof shop>>, paymentId: string) {
  const { rows } = await db.query<{ order_id: string; total_cents: string }>(
    'SELECT p.order_id, o.total_cents FROM payments.api_payments p JOIN commerce.orders o ON o.id = p.order_id WHERE p.id = $1',
    [paymentId],
  );
  const charges = new Map<string, 'pending' | 'approved' | 'declined'>();
  const clear: ClearCharges = {
    raise: async () => {
      const code = `V1C${++seq}`;
      charges.set(code, 'pending');
      return { ok: true, code };
    },
    status: async (code) => charges.get(code) ?? null,
    cancel: async () => true,
    sendTo: async () => ({ ok: true, label: 'their Clear app' }),
  };
  const tender = await createClearTender(db, clear, { merchant: s.merchant, orderId: rows[0]!.order_id, staffId: null, source: 'online', tender: { amountCents: Number(rows[0]!.total_cents), tipCents: 0, idempotencyKey: key() } });
  return {
    approve: async () => {
      charges.set(tender.clearChargeCode!, 'approved');
      await syncClearTender(db, clear, { merchant: s.merchant, tenderId: tender.id, actor: null });
    },
    decline: async () => {
      charges.set(tender.clearChargeCode!, 'declined');
      await syncClearTender(db, clear, { merchant: s.merchant, tenderId: tender.id, actor: null });
    },
  };
}

describe('webhooks', () => {
  /** A shop's endpoint, as a recording fetch that answers with `status`. */
  function endpointServer(status: () => number) {
    const got: Array<{ url: string; headers: Headers; body: string }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      got.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response('', { status: status() });
    }) as typeof fetch;
    return { got, fetchImpl };
  }

  test('payment.succeeded, signed, and verified by @useclear/node with the endpoint’s secret', async () => {
    const s = await shop();
    const clear = s.sdk(s.liveSecret);
    const endpoint = await clear.webhookEndpoints.create({ url: 'https://micasatacos.com/clear/webhook', events: ['payment.succeeded', 'payment.failed', 'refund.succeeded'] });
    expect(endpoint.secret).toMatch(/^whsec_/);
    const payment = await clear.payments.create(SNIPPET, { idempotencyKey: key() });
    expect((await clear.payments.retrieve(payment.id)).status).toBe('requires_customer');
    const pay = await payWithClear(s, payment.id);
    expect((await clear.payments.retrieve(payment.id)).status).toBe('processing');
    await pay.approve();
    const paid = await clear.payments.retrieve(payment.id);
    expect(paid).toMatchObject({ status: 'succeeded', method: 'clear' });

    const ep = endpointServer(() => 200);
    expect(await deliverDue(db, { fetch: ep.fetchImpl, now: () => new Date() })).toBeGreaterThanOrEqual(1);
    const mine = ep.got.filter((g) => JSON.parse(g.body).data?.id === payment.id);
    expect(mine).toHaveLength(1);
    // The spec's handler: verify, then fulfil from event.data.reference.
    const shopServer = s.sdk(s.liveSecret, endpoint.secret!);
    const event = Event.parse(shopServer.webhooks.verify(Buffer.from(mine[0]!.body), mine[0]!.headers.get('clear-signature')!));
    expect(event).toMatchObject({ type: 'payment.succeeded', livemode: true, apiVersion: '2026-10-16', data: { reference: 'catering-1042', status: 'succeeded', amount: 18532 } });
    expect('clientSecret' in event.data).toBe(false);
    // Another endpoint's secret doesn't verify it, and a changed body doesn't either.
    expect(() => shopServer.webhooks.verify(Buffer.from(mine[0]!.body), mine[0]!.headers.get('clear-signature')!, 'whsec_someoneelse')).toThrow();
    expect(() => shopServer.webhooks.verify(Buffer.from(mine[0]!.body.replace('18532', '1')), mine[0]!.headers.get('clear-signature')!)).toThrow();
  });

  test('payment.failed for a declined Clear charge, once', async () => {
    const s = await shop();
    const clear = s.sdk(s.liveSecret);
    await clear.webhookEndpoints.create({ url: 'https://micasatacos.com/hooks', events: ['payment.failed'] });
    const payment = await clear.payments.create(SNIPPET, { idempotencyKey: key() });
    const pay = await payWithClear(s, payment.id);
    await pay.decline();
    expect((await clear.payments.retrieve(payment.id)).status).toBe('failed');
    const { rows } = await db.query<{ type: string }>(`SELECT type FROM payments.webhook_events WHERE merchant = $1`, [s.merchant]);
    expect(rows.map((r) => r.type)).toEqual(['payment.failed']);
  });

  test('a failed delivery is retried with backoff, and given up after 3 days', async () => {
    const s = await shop();
    const clear = s.sdk(s.liveSecret);
    await clear.webhookEndpoints.create({ url: 'https://down.example.com/hook', events: ['payment.canceled'] });
    const payment = await clear.payments.create(SNIPPET, { idempotencyKey: key() });
    expect((await clear.payments.cancel(payment.id)).status).toBe('canceled');
    const ep = endpointServer(() => 500);
    const t0 = new Date();
    await deliverDue(db, { fetch: ep.fetchImpl, now: () => t0 });
    const { rows } = await db.query<{ status: string; attempts: number; response_code: number; next_attempt_at: Date }>(
      `SELECT d.status, d.attempts, d.response_code, d.next_attempt_at FROM payments.webhook_deliveries d JOIN payments.webhook_events e ON e.id = d.event_id WHERE e.merchant = $1`,
      [s.merchant],
    );
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1, response_code: 500 });
    expect(new Date(rows[0]!.next_attempt_at).getTime() - t0.getTime()).toBe(60_000);
    // The schedule: 1, 5, 30 minutes, 2, 5, 10 hours, then every 12, until 3 days after it was made.
    const made = new Date('2026-10-16T00:00:00Z');
    expect(nextAttempt(made, 2, made)!.getTime() - made.getTime()).toBe(5 * 60_000);
    expect(nextAttempt(made, 9, made)!.getTime() - made.getTime()).toBe(720 * 60_000);
    expect(nextAttempt(made, 30, new Date(made.getTime() + RETRY_FOR_MS - 60_000))).toBeNull();
  });

  test('deliveries through the API: each try, the endpoint’s answer, newest first, the key’s mode only', async () => {
    const s = await shop();
    const clear = s.sdk(s.liveSecret);
    const endpoint = await clear.webhookEndpoints.create({ url: 'https://down.example.com/hook2', events: ['payment.canceled'] });
    const payment = await clear.payments.create(SNIPPET, { idempotencyKey: key() });
    await clear.payments.cancel(payment.id);
    await deliverDue(db, { fetch: endpointServer(() => 500).fetchImpl, now: () => new Date() });
    const list = await clear.webhookDeliveries.list({ endpoint: endpoint.id });
    expect(list.hasMore).toBe(false);
    expect(list.data).toHaveLength(1);
    const d = WebhookDelivery.parse(list.data[0]);
    expect(d).toMatchObject({ object: 'webhook_delivery', livemode: true, endpoint: endpoint.id, event: { type: 'payment.canceled' }, status: 'pending', attempts: 1, responseStatus: 500 });
    expect(d.nextAttemptAt).not.toBeNull();
    expect((await clear.webhookDeliveries.list({ status: 'succeeded' })).data).toHaveLength(0);
    // The test key sees none of the live ones.
    expect((await s.sdk(s.testSecret).webhookDeliveries.list()).data).toHaveLength(0);
  });

  test('only the key’s mode: a live endpoint never hears about a test payment', async () => {
    const s = await shop();
    await s.sdk(s.liveSecret).webhookEndpoints.create({ url: 'https://micasatacos.com/live', events: ['payment.canceled'] });
    const testPayment = await s.sdk(s.testSecret).payments.create(SNIPPET, { idempotencyKey: key() });
    await s.sdk(s.testSecret).payments.cancel(testPayment.id);
    const { rows } = await db.query(`SELECT 1 FROM payments.webhook_deliveries d JOIN payments.webhook_events e ON e.id = d.event_id WHERE e.merchant = $1`, [s.merchant]);
    expect(rows).toHaveLength(0);
  });

  test('an endpoint inside a network is refused', async () => {
    const s = await shop();
    for (const url of ['https://localhost/hook', 'https://10.0.0.5/hook', 'https://api.railway.internal/hook', 'http://micasatacos.com/hook']) {
      await expect(s.sdk(s.liveSecret).webhookEndpoints.create({ url, events: ['payment.succeeded'] })).rejects.toBeInstanceOf(ClearError);
    }
  });
});

describe('cancel', () => {
  test('a payment that started first isn’t canceled, and never reads as canceled', async () => {
    const s = await shop();
    const clear = s.sdk(s.liveSecret);
    const payment = await clear.payments.create(SNIPPET, { idempotencyKey: key() });
    const { rows } = await db.query<{ order_id: string }>('SELECT order_id FROM payments.api_payments WHERE id = $1', [payment.id]);
    // Part of it was paid between the payment's read and the discard: the payment still reads as waiting
    // on the customer, but the order can't be thrown away.
    await db.query(
      `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, tip_cents, idempotency_key, request_hash, created_by, status, clear_charge_code)
       VALUES ($1, $2, $3, 'clear', 1000, 0, $4, 'h', NULL, 'approved', $5)`,
      [`tnd_race_${seq}`, s.merchant, rows[0]!.order_id, key(), `RACE${seq}`],
    );
    expect((await clear.payments.retrieve(payment.id)).status).toBe('requires_customer');
    await expect(clear.payments.cancel(payment.id)).rejects.toMatchObject({ code: 'payment_not_cancelable' });
    expect((await clear.payments.retrieve(payment.id)).status).toBe('requires_customer');
    const { rows: marked } = await db.query<{ canceled_at: unknown }>('SELECT canceled_at FROM payments.api_payments WHERE id = $1', [payment.id]);
    expect(marked[0]!.canceled_at).toBeNull();
  });
});

describe('refunds', () => {
  async function cardPayment(s: Awaited<ReturnType<typeof shop>>) {
    const payment = await s.sdk(s.liveSecret).payments.create(SNIPPET, { idempotencyKey: key() });
    const { rows } = await db.query<{ order_id: string }>('SELECT order_id FROM payments.api_payments WHERE id = $1', [payment.id]);
    const started = await checkoutTender(db, fake.provider, { merchant: s.merchant, orderId: rows[0]!.order_id, amountCents: 18532, lineName: 'Mi Casa Tacos', successUrl: 'https://x.example/ok', cancelUrl: 'https://x.example/no', idempotencyKey: key(), source: 'online' });
    const { rows: t } = await db.query<{ checkout_session_id: string }>('SELECT checkout_session_id FROM payments.tenders WHERE id = $1', [started.tenderId]);
    const paymentIntent = fake.payCheckout(t[0]!.checkout_session_id);
    const event = { type: 'checkout.session.completed', account: `acct_${s.merchant.slice(-8)}`, data: { object: { id: t[0]!.checkout_session_id, payment_intent: paymentIntent } } } as unknown as Stripe.Event;
    await db.transaction((tx) => cardPaymentHandlers(() => fake.provider)['checkout.session.completed']!(tx, event));
    return payment;
  }

  test('a card payment, in part, at once, through the card processor, with refund.succeeded', async () => {
    const s = await shop({ cards: true });
    const payment = await cardPayment(s);
    expect((await s.sdk(s.liveSecret).payments.retrieve(payment.id)).method).toBe('card');
    const refund = await s.sdk(s.liveSecret).refunds.create({ payment: payment.id, amount: 2200, reason: 'Two aguas short' }, { idempotencyKey: key() });
    expect(Refund.parse(refund)).toMatchObject({ payment: payment.id, amount: 2200, status: 'succeeded', reason: 'Two aguas short' });
    expect((await s.sdk(s.liveSecret).payments.retrieve(payment.id)).amountRefunded).toBe(2200);
    const { rows } = await db.query<{ data: { id: string } }>(`SELECT data FROM payments.webhook_events WHERE merchant = $1 AND type = 'refund.succeeded'`, [s.merchant]);
    expect(rows[0]!.data.id).toBe(refund.id);
    await expect(s.sdk(s.liveSecret).refunds.create({ payment: payment.id, amount: 18532 }, { idempotencyKey: key() })).rejects.toMatchObject({ code: 'refund_exceeds_payment' });
  });

  test('asked to wait, it waits for an owner or manager', async () => {
    const s = await shop({ cards: true });
    const payment = await cardPayment(s);
    expect((await s.sdk(s.liveSecret).refunds.create({ payment: payment.id, requireApproval: true }, { idempotencyKey: key() })).status).toBe('pending_approval');
  });

  test('a Clear payment is refunded in the merchant app; a part of one is refused', async () => {
    const s = await shop();
    const payment = await s.sdk(s.liveSecret).payments.create(SNIPPET, { idempotencyKey: key() });
    await (await payWithClear(s, payment.id)).approve();
    await expect(s.sdk(s.liveSecret).refunds.create({ payment: payment.id, amount: 100 }, { idempotencyKey: key() })).rejects.toMatchObject({ code: 'partial_refund_unsupported' });
    await expect(s.sdk(s.liveSecret).refunds.create({ payment: payment.id }, { idempotencyKey: key() })).rejects.toMatchObject({ code: 'refund_in_app' });
  });
});

describe('payment links through the API', () => {
  test('a price link in the key’s mode, at pay.useclear.org', async () => {
    const s = await shop();
    const price = `price_${s.tray.id.replace(/^itm_/, '').replace(/[^A-Za-z0-9]/g, '')}`;
    const link = await s.sdk(s.testSecret).paymentLinks.create({ price, note: 'Saturday pickup, 11:30am' });
    expect(link).toMatchObject({ object: 'payment_link', livemode: false, price, quantity: 1, amount: null, active: true, url: expect.stringMatching(/^https:\/\/pay\.useclear\.org\/l\//) });
    await expect(s.sdk(s.testSecret).paymentLinks.create({ price: 'price_nothing' })).rejects.toMatchObject({ code: 'price_not_found' });
  });
});

describe('the API’s own answers', () => {
  test('an unknown route and a body that isn’t JSON have the error shape', async () => {
    const s = await shop();
    expect((await body(await call('/v1/nothing', { key: s.liveSecret }))).error.code).toBe('route_not_found');
    const res = await fetch(`${base}/v1/payment_links`, { method: 'POST', headers: { Authorization: `Bearer ${s.liveSecret}`, 'Content-Type': 'application/json' }, body: '{nope' });
    expect(res.status).toBe(400);
    expect((await body(res)).error.code).toBe('parameter_invalid');
  });
  test('every route the docs list exists (docs/api.md is generated from the same list)', async () => {
    const s = await shop();
    for (const e of ENDPOINTS) {
      const path = e.path.replace(':id', 'x_none');
      const res = await call(path, { method: e.method, key: e.key === 'publishable' ? s.livePk : s.liveSecret, body: e.method === 'POST' ? {} : undefined, headers: e.idempotent ? { 'Idempotency-Key': key() } : {} });
      const code = res.status === 204 ? null : (await body(res).catch(() => null))?.error?.code;
      expect({ route: `${e.method} ${e.path}`, code }).not.toEqual({ route: `${e.method} ${e.path}`, code: 'route_not_found' });
    }
  });
  test('a preflight from any website is answered without credentials', async () => {
    const res = await fetch(`${base}/v1/modal_sessions`, { method: 'OPTIONS', headers: { Origin: 'https://micasatacos.com', 'Access-Control-Request-Method': 'POST' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://micasatacos.com');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });
});


describe('Settings › Developers, from the API', () => {
  test('both modes’ keys, the sites, and the paste-in prompt with the live publishable key', async () => {
    const { developersView } = await import('./payLinks.js');
    const s = await shop();
    const view = await developersView(db, s.merchant);
    expect(view.keys.map((k) => `${k.kind}:${k.livemode}`).sort()).toEqual(['publishable:false', 'publishable:true', 'secret:false', 'secret:true']);
    expect(view.keys.find((k) => k.kind === 'secret')!.token).toBeNull();
    expect(view.sites.map((x) => x.origin)).toEqual(['https://micasatacos.com', 'http://localhost:3000']);
    expect(view.sites[1]!.testOnly).toBe(true);
    expect(view.ai.prompt).toContain(`Use publishable key ${s.livePk}.`);
  });
});
