import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PaySession, PublicLink, PublicPayStarted } from '@clear/merchant-contracts';
import type { Db } from '../db/db.js';
import { seedShop, testDb } from '../db/testDb.js';
import * as catalog from '../services/merchant/catalog/catalogService.js';
import type { OrderDeps } from '../services/merchant/orders/orderService.js';
import type { ClearCharges } from '../services/merchant/orders/payments.js';
import { createPaymentLink } from '../services/merchant/pay/links.js';
import { checkoutRouter, linkPageRouter, type PayRouteDeps } from './payLinks.js';

/**
 * The link page's routes over HTTP (pay prompt, Phase 3): what `pay.useclear.org/l/:slug` reads and
 * sends, each answer checked against the contract the page is typed from.
 */

let db: Db;
let server: Server;
let base: string;
const orders: OrderDeps = { taxApi: null, pinCheck: async () => null };
let codes = 0;
const clear: ClearCharges = {
  raise: async () => ({ ok: true, code: `HTTP${++codes}AB` }),
  status: async () => 'pending',
  cancel: async () => true,
  sendTo: async () => ({ ok: true, label: 'their Clear app' }),
};
const pass: express.RequestHandler = (_req, _res, next) => next();

beforeAll(async () => {
  ({ db } = await testDb());
  const deps: PayRouteDeps = { db: async () => db, session: () => ({ orders, clear, card: async () => null }), limits: { read: pass, act: pass } };
  const app = express();
  app.use(express.json());
  app.use('/api/l', linkPageRouter(deps));
  app.use('/api/checkout', checkoutRouter(deps));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

async function trayLink(expires: '7d' | 'never' = '7d', now?: Date) {
  const s = await seedShop(db);
  await db.query(
    `UPDATE merchant.profiles SET name = 'Mi Casa Tacos', address_line1 = '201 E State St', address_city = 'Redlands', address_region = 'CA', address_postal_code = '92373',
       address_country = 'US', tax_rates = $2, tax_rates_address = '201 e state st|redlands|ca|92373|us', timezone = 'America/Los_Angeles' WHERE merchant = $1`,
    [
    s.merchant,
    JSON.stringify({ food: 83750, goods: 83750, labour: null }),
  ]);
  const tray = await catalog.createItem(db, { merchant: s.merchant, staffId: s.staff.owner, item: { name: 'Taco tray for 12', detail: null, category: 'Catering', priceCents: 14900, costCents: null, taxKind: 'food', stockTracked: false, reorderAt: null } });
  return createPaymentLink(db, orders, { merchant: s.merchant, staffId: s.staff.owner, now, request: { for: 'item', itemId: tray.id, quantity: 1, note: 'Saturday pickup, 11:30am', expires, allowOverTime: true } });
}

const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('GET /api/l/:slug', () => {
  test('the page’s figures, as the contract has them, never cached', async () => {
    const link = await trayLink();
    const res = await fetch(`${base}/api/l/${link.slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const page = PublicLink.parse(await res.json());
    expect(page.order.totalCents).toBe(16148);
    expect(page.note).toBe('Saturday pickup, 11:30am');
  });

  test('an unknown address is a 404 with a sentence', async () => {
    const res = await fetch(`${base}/api/l/nobody-abcdef`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found', message: 'There’s no payment at this address' });
  });
});

describe('paying a link over HTTP', () => {
  test('a session, its view, and a Clear charge for the link’s amount whatever the body says', async () => {
    const link = await trayLink();
    const started = await post(`/api/l/${link.slug}/session`, { amountCents: 1 });
    expect(started.status).toBe(200);
    const { session } = (await started.json()) as { session: string };
    const view = PaySession.parse(await (await fetch(`${base}/api/checkout/${session}`)).json());
    expect(view).toMatchObject({ state: 'open', order: { totalCents: 16148 }, methods: { clear: true, card: false } });
    const paid = await post(`/api/checkout/${session}/pay`, { method: 'clear', idempotencyKey: 'http-pay-0001', amountCents: 1 });
    expect(paid.status).toBe(200);
    const charge = PublicPayStarted.parse(await paid.json());
    expect(charge.method).toBe('clear');
    const { rows } = await db.query<{ amount_cents: string }>('SELECT amount_cents FROM payments.tenders WHERE clear_charge_code = $1', [charge.method === 'clear' ? charge.chargeCode : '']);
    expect(Number(rows[0]!.amount_cents)).toBe(16148);
  });

  test('card at a shop with no processor is refused with a sentence', async () => {
    const link = await trayLink();
    const { session } = (await (await post(`/api/l/${link.slug}/session`, {})).json()) as { session: string };
    const res = await post(`/api/checkout/${session}/pay`, { method: 'card', idempotencyKey: 'http-pay-0002' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'unavailable' });
  });

  test('an expired link is gone (410)', async () => {
    const link = await trayLink('7d', new Date('2026-01-01T00:00:00Z'));
    const res = await post(`/api/l/${link.slug}/session`, {});
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: 'expired' });
  });

  test('a session id that isn’t one is a 404', async () => {
    const res = await fetch(`${base}/api/checkout/ps_nothing`);
    expect(res.status).toBe(404);
  });
});
