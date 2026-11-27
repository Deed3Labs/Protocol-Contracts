import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type Stripe from 'stripe';
import type { ShopStripe } from '../services/merchant/hardwareOrders/hardwareOrdersService.js';
import type { MerchantSession } from '../services/merchant/sessionStore.js';
import { merchantHardwareOrdersRouter } from './merchantHardwareOrders.js';

/* On order over HTTP: the real router, with a stand-in for signing in and for the site's Stripe. */

const SHOP = '0x00000000000000000000000000000000000000aa';
let base = '';
let configured = true;
const refunds: number[] = [];
const pi = {
  id: 'pi_1',
  status: 'succeeded',
  created: 1_790_000_000,
  metadata: { kind: 'reservation', shop_id: SHOP, reserved_at: '2026-10-16T00:00:00Z', r1: 'clear-point/table/4/8900/5500/Feb 2027', s1: 'reserved' } as Record<string, string>,
} as unknown as Stripe.PaymentIntent;
const stripe: ShopStripe = {
  paymentIntents: {
    search: async () => ({ data: [pi], has_more: false }),
    retrieve: async () => pi,
    update: async (_id, { metadata }) => (Object.assign(pi.metadata, metadata), pi),
  },
  refunds: { create: async (p) => (refunds.push(p.amount), { id: 're_1' }) },
};

beforeAll(() => {
  const signedIn = (req: Request, res: Response, next: NextFunction) => {
    const role = String(req.header('x-test-role') ?? '');
    if (!role) return res.status(401).json({ error: 'Unauthorized' });
    req.merchant = { merchant: SHOP, staff: { id: 'stf', role, name: 'X' }, expiresAt: '' } as unknown as MerchantSession;
    next();
  };
  const needs = (roles: string[]) => (req: Request, res: Response, next: NextFunction) => (roles.includes(req.merchant!.staff.role) ? next() : res.status(403).json({ error: 'Forbidden' }));
  const app = express();
  app.use(express.json());
  app.use('/api/merchant', merchantHardwareOrdersRouter({ stripe: () => (configured ? stripe : null), auth: { merchant: signedIn, manager: needs(['manager', 'owner']), owner: needs(['owner']) } }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

const call = async (path: string, role: string, method = 'GET') => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: method === 'POST' ? '{}' : undefined });
  return { status: r.status, body: (await r.json()) as { orders: Array<{ lines: Array<Record<string, unknown>> }>; configured?: boolean } };
};

describe('On order', () => {
  test('owners and managers see the shop’s reservations; counter staff do not', async () => {
    const r = await call('/api/merchant/hardware/orders', 'manager');
    expect(r.status).toBe(200);
    expect(r.body.orders[0].lines[0]).toMatchObject({ name: 'Clear Point, Table', depositCents: 22000, cancellable: true });
    expect((await call('/api/merchant/hardware/orders', 'counter')).status).toBe(403);
    expect((await call('/api/merchant/hardware/orders', '')).status).toBe(401);
  });
  test('only the owner cancels, and gets the list back with the line refunded', async () => {
    expect((await call('/api/merchant/hardware/orders/pi_1/lines/1/cancel', 'manager', 'POST')).status).toBe(403);
    const r = await call('/api/merchant/hardware/orders/pi_1/lines/1/cancel', 'owner', 'POST');
    expect(r.status).toBe(200);
    expect(r.body.orders[0].lines[0]).toMatchObject({ status: 'refunded', cancellable: false });
    expect(refunds).toEqual([22000]);
    expect((await call('/api/merchant/hardware/orders/pi_1/lines/1/cancel', 'owner', 'POST')).status).toBe(409);
    expect((await call('/api/merchant/hardware/orders/pi_1/lines/99/cancel', 'owner', 'POST')).status).toBe(404);
  });
  test('without the site’s Stripe key: nothing to show, and nothing to cancel', async () => {
    configured = false;
    expect((await call('/api/merchant/hardware/orders', 'owner')).body).toEqual({ configured: false, orders: [] });
    expect((await call('/api/merchant/hardware/orders/pi_1/lines/1/cancel', 'owner', 'POST')).status).toBe(503);
    configured = true;
  });
});
