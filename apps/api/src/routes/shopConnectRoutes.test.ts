import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { seedShop, testDb } from '../db/testDb.js';
import type { BridgeKyb } from '../services/merchant/kyb/kybService.js';
import type { MerchantSession } from '../services/merchant/sessionStore.js';
import { merchantConnectRouter } from './merchantConnect.js';
import { publicShopsRouter } from './publicShops.js';

/*
 * Shop sign-in for useclear.org over HTTP: the real routers on PGlite, with a stand-in for signing in
 * (`x-test-staff: <id>:<role>`) and for Bridge (the shop's verification state).
 */

let db: Db;
let base = '';
let shop: Awaited<ReturnType<typeof seedShop>>;
let bridgeStatus: 'active' | 'rejected' | null = null;

const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const SITE_KEY = 'k'.repeat(40);
const env = { SHOP_CONNECT_PRIVATE_KEY: pem, SHOP_SITE_API_KEY: SITE_KEY } as NodeJS.ProcessEnv;
const bridge = (): BridgeKyb => ({
  configured: () => true,
  start: async () => ({ customerId: null, url: null }),
  snapshot: async (id) =>
    bridgeStatus ? { customerId: id, type: 'business', status: bridgeStatus, tosAccepted: true, baseEndorsement: 'approved', payinFiat: 'active', payoutFiat: 'active', rejectionReason: null } : null,
});

beforeAll(async () => {
  ({ db } = await testDb());
  await db.query('ALTER TABLE merchant.staff ADD COLUMN IF NOT EXISTS email TEXT');
  shop = await seedShop(db);
  await db.query("UPDATE merchant.profiles SET name = 'Mi Casa Tacos', bridge_customer_id = 'cus_biz' WHERE merchant = $1", [shop.merchant]);
  const signedIn = (req: Request, res: Response, next: NextFunction) => {
    const [id, role] = String(req.header('x-test-staff') ?? '').split(':');
    if (!id) return res.status(401).json({ error: 'Unauthorized' });
    req.merchant = { merchant: shop.merchant, staff: { id, role, name: id }, expiresAt: '' } as unknown as MerchantSession;
    next();
  };
  const owner = (req: Request, res: Response, next: NextFunction) => (req.merchant!.staff.role === 'owner' ? next() : res.status(403).json({ error: 'Forbidden' }));
  const app = express();
  app.use(express.json());
  app.use('/api/merchant', merchantConnectRouter({ db: async () => db, auth: { merchant: signedIn, owner }, bridge, env: () => env }));
  app.use('/api/public', publicShopsRouter({ db: async () => db, bridge, env: () => env }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

async function call(path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) {
  const r = await fetch(base + path, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // plain text (the public key)
  }
  return { status: r.status, body: body as Record<string, string> };
}

const RETURN = 'https://www.useclear.org/api/shop/account/return';
const STATE = 'state_' + 'a'.repeat(20);
const owner = { 'x-test-staff': '' };

describe('POST /api/merchant/connect/token', () => {
  test('the owner gets a redirect back to the site carrying a verifiable token', async () => {
    owner['x-test-staff'] = `${shop.staff.owner}:owner`;
    const r = await call('/api/merchant/connect/token', { body: { return: RETURN, state: STATE }, headers: owner });
    expect(r.status).toBe(200);
    const back = new URL(r.body.redirect);
    expect(back.origin + back.pathname).toBe(RETURN);
    expect(back.searchParams.get('state')).toBe(STATE);
    const [h, p, s] = back.searchParams.get('token')!.split('.');
    const pub = createPublicKey((await call('/api/public/shop-connect/key')).body as unknown as string);
    expect(verify(null, Buffer.from(`${h}.${p}`), pub, Buffer.from(s, 'base64url'))).toBe(true);
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(claims).toMatchObject({ aud: 'useclear.org/shop', sub: shop.merchant, name: 'Mi Casa Tacos', owner: 'Marcus', state: STATE, approval: 'pending' });
    const { rows } = await db.query<{ action: string; ref_id: string }>("SELECT action, ref_id FROM payments.audit_log WHERE merchant = $1 AND action = 'shop.connected'", [shop.merchant]);
    expect(rows[0]?.ref_id).toBe('https://www.useclear.org');
  });
  test('not signed in, or not the owner, is refused', async () => {
    expect((await call('/api/merchant/connect/token', { body: { return: RETURN, state: STATE } })).status).toBe(401);
    expect((await call('/api/merchant/connect/token', { body: { return: RETURN, state: STATE }, headers: { 'x-test-staff': `${shop.staff.manager}:manager` } })).status).toBe(403);
  });
  test('a return address that is not the site, or a bad state, gets no token', async () => {
    owner['x-test-staff'] = `${shop.staff.owner}:owner`;
    for (const body of [
      { return: 'https://evil.example/api/shop/account/return', state: STATE },
      { return: RETURN + '?x=1', state: STATE },
      { return: RETURN, state: 'short' },
      { return: RETURN },
    ]) {
      const r = await call('/api/merchant/connect/token', { body, headers: owner });
      expect(r.status).toBe(400);
      expect(r.body.redirect).toBeUndefined();
    }
  });
});

describe('GET /api/public/shops/:id/approval', () => {
  test('answers the site, with its key, from the shop’s verification', async () => {
    const auth = { authorization: `Bearer ${SITE_KEY}` };
    bridgeStatus = 'active';
    expect((await call(`/api/public/shops/${shop.merchant}/approval`, { headers: auth })).body).toEqual({ status: 'approved' });
    bridgeStatus = 'rejected';
    expect((await call(`/api/public/shops/${shop.merchant}/approval`, { headers: auth })).body).toEqual({ status: 'declined' });
    bridgeStatus = null;
    expect((await call(`/api/public/shops/${shop.merchant}/approval`, { headers: auth })).body).toEqual({ status: 'pending' });
    expect((await call(`/api/public/shops/0x${'e'.repeat(40)}/approval`, { headers: auth })).status).toBe(404);
    expect((await call('/api/public/shops/not-an-address/approval', { headers: auth })).status).toBe(404);
  });
  test('without the site’s key it says nothing', async () => {
    expect((await call(`/api/public/shops/${shop.merchant}/approval`)).status).toBe(401);
    expect((await call(`/api/public/shops/${shop.merchant}/approval`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
  });
});
