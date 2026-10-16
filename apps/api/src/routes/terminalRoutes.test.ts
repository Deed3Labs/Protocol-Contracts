import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { Db } from '../db/db.js';
import { seedShop, testDb } from '../db/testDb.js';
import type { MerchantSession } from '../services/merchant/sessionStore.js';
import { newSigningKey, publishFirmware, signFirmware, trustedKeys } from '../services/merchant/terminal/firmware.js';
import { devicePointRouter } from './devicePoint.js';
import { merchantTerminalRouter } from './merchantTerminal.js';
import { pointPageRouter, receiptPageRouter, type PhonePageDeps } from './phonePages.js';

/*
 * Clear Terminal over HTTP: the real routers on PGlite, with a stand-in for signing in (the shift's
 * bearer token is sessionStore's, tested on its own): `x-test-staff: <id>:<role>` signs that person in.
 */

let db: Db;
let base = '';
let shop: Awaited<ReturnType<typeof seedShop>>;

const pass = (_req: Request, _res: Response, next: NextFunction) => next();

beforeAll(async () => {
  ({ db } = await testDb());
  shop = await seedShop(db);
  const signedIn = (req: Request, res: Response, next: NextFunction) => {
    const [id, role] = String(req.header('x-test-staff') ?? '').split(':');
    if (!id) return res.status(401).json({ error: 'Unauthorized' });
    req.merchant = { merchant: shop.merchant, staff: { id, role, name: id }, expiresAt: '' } as unknown as MerchantSession;
    next();
  };
  const needs = (roles: string[]) => (req: Request, res: Response, next: NextFunction) =>
    roles.includes(req.merchant!.staff.role) ? next() : res.status(403).json({ error: 'Forbidden' });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/merchant',
    merchantTerminalRouter({
      db: async () => db,
      auth: { merchant: signedIn, manager: needs(['manager', 'owner']), owner: needs(['owner']), device: pass },
      texter: { send: async () => true },
      pinCheck: async () => null,
      apiBase: () => 'https://api.example',
    }),
  );
  const pages: PhonePageDeps = { db: async () => db, pay: () => ({ clear: {} as never, card: async () => null }), sendEmail: async () => true, limits: { read: pass, act: pass } };
  app.use('/api/p', pointPageRouter(pages));
  app.use('/api/r', receiptPageRouter(pages));
  app.use('/api/device/point', devicePointRouter({ db: async () => db, limit: pass, waitMs: 300 }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

const as = (who: 'owner' | 'manager' | 'jen') => ({ 'x-test-staff': `${shop.staff[who]}:${who === 'jen' ? 'counter' : who}` });
async function call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const r = await fetch(base + path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  return { status: r.status, headers: r.headers, body: text ? JSON.parse(text) : null };
}

let point: { id: string; code: string; key: string };
let tableId = '';

describe('the tablet’s routes', () => {
  test('the counter sees the hardware; only the owner adds a Point', async () => {
    await call('/api/merchant/tables', { method: 'PUT', headers: as('manager'), body: { tables: [{ number: 6, label: null, area: 'by the window', seats: 2 }] } });
    tableId = (await call('/api/merchant/tables', { headers: as('jen') })).body.tables[0].id;
    await db.query(`INSERT INTO merchant.point_keys (code) VALUES ('T6T6')`);
    expect((await call('/api/merchant/points/claim', { headers: as('jen'), body: { code: 'T6T6' } })).status).toBe(403);
    const claimed = await call('/api/merchant/points/claim', { headers: as('owner'), body: { code: 'T6T6' } });
    expect(claimed.status).toBe(200);
    expect(claimed.body.provisioning.apiBase).toBe('https://api.example');
    const id = claimed.body.device.id;
    expect((await call(`/api/merchant/hardware/${id}`, { method: 'PATCH', headers: as('jen'), body: { point: { placement: 'table', tableId } } })).status).toBe(403);
    expect((await call(`/api/merchant/hardware/${id}`, { method: 'PATCH', headers: as('owner'), body: { name: 'Table 6', point: { placement: 'table', tableId } } })).status).toBe(200);
    const activated = await call('/api/device/point/activate', { body: { code: 'T6T6', secret: claimed.body.provisioning.secret } });
    expect(activated.status).toBe(200);
    point = { id, code: 'T6T6', key: activated.body.deviceKey };
    const list = await call('/api/merchant/hardware', { headers: as('jen') });
    expect(list.body.map((d: { name: string }) => d.name)).toEqual(['Table 6']);
  });

  test('the drawer’s log over HTTP: a repeat is a duplicate', async () => {
    const drawer = await call('/api/merchant/hardware', {
      headers: as('owner'),
      body: { kind: 'drawer', name: 'Clear Drawer 4F2A', settings: { bluetoothId: 'C1:EA:4F:2A', pairedTabletId: null, cabledToPrinter: false, printerId: null } },
    });
    expect(drawer.status).toBe(201);
    const batch = { events: [{ kind: 'opened', clientId: 'evt-route-1', drawerId: drawer.body.id, at: new Date().toISOString(), staffId: shop.staff.jen, reason: 'test', orderId: null, noSale: null, approvalId: null }] };
    expect((await call('/api/merchant/drawer/events', { headers: as('jen'), body: batch })).body).toEqual({ saved: 1, duplicates: 0 });
    expect((await call('/api/merchant/drawer/events', { headers: as('jen'), body: batch })).body).toEqual({ saved: 0, duplicates: 1 });
    expect((await call(`/api/merchant/drawers/${drawer.body.id}/key`, { headers: as('jen') })).body.keyId).toMatch(/^dk_/);
  });
});

describe('the Point’s own API', () => {
  test('no key, no answer', async () => {
    expect((await call('/api/device/point/state')).status).toBe(401);
    expect((await call('/api/device/point/state', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  test('state with an ETag; asked again unchanged it waits and says 304; a change answers at once', async () => {
    const auth = { authorization: `Bearer ${point.key}` };
    const first = await call('/api/device/point/state', { headers: auth });
    expect(first.status).toBe(200);
    expect(first.body.state).toEqual({ kind: 'idle', mode: 'number' });
    const tag = first.headers.get('etag')!;
    const t0 = Date.now();
    expect((await call('/api/device/point/state', { headers: { ...auth, 'if-none-match': tag } })).status).toBe(304);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);

    const party = await call('/api/merchant/waitlist', { headers: as('manager'), body: { name: 'Ana', size: 2, phone: null, textConsent: false } });
    const waitingForChange = call('/api/device/point/state', { headers: { ...auth, 'if-none-match': tag } });
    await call(`/api/merchant/waitlist/${party.body.id}/seat`, { headers: as('manager'), body: { tableId, showName: true, text: false } });
    const changed = await waitingForChange;
    expect(changed.status).toBe(200);
    expect(changed.body.state).toMatchObject({ kind: 'held', partyName: 'Ana' });
    expect(changed.body.lit).toBe(true);
  });

  test('health, and a Call pressed on the case', async () => {
    const auth = { authorization: `Bearer ${point.key}` };
    expect((await call('/api/device/point/health', { headers: auth, body: { batteryPercent: 82, pluggedIn: false, rssi: -61, ssid: 'MiCasa-Staff', firmware: '1.0.3', case: { kind: 'pay', buttons: 'ok' } } })).status).toBe(204);
    const pressed = await call('/api/device/point/event', { headers: auth, body: { kind: 'button', button: 'call', at: new Date().toISOString() } });
    expect(pressed.body.request).toMatchObject({ kind: 'call', state: 'open' });
    const answered = await call(`/api/merchant/table-requests/${pressed.body.request.id}/answer`, { headers: as('jen'), body: {} });
    expect(answered.body).toMatchObject({ state: 'answered', answeredBy: shop.staff.jen });
    const list = await call('/api/merchant/hardware', { headers: as('owner') });
    expect(list.body[0].health).toMatchObject({ batteryPercent: 82, case: { kind: 'pay', buttons: 'ok' } });
  });
});

/*
 * The fake Point (apps/merchant/scripts/fake-point.ts), run as its own process against these routes:
 * the e2e path with no hardware. It activates with the claim's secret, reports health, follows its
 * screen by long poll, and presses Call; every answer is parsed with the contract.
 */
const routeKey = newSigningKey('clear-route');
const trustedKey = routeKey.publicKey;

describe('firmware for a Point', () => {
  test('none published: 204; published for its model: the signed manifest; no key: 401', async () => {
    const auth = { authorization: `Bearer ${point.key}` };
    expect((await call('/api/device/point/firmware', { headers: auth })).status).toBe(204);
    const k = routeKey;
    const m = signFirmware({ privateKey: k.privateKey, keyId: k.keyId, model: 'point', version: '1.0.4', url: 'https://firmware.example/point-1.0.4.bin', image: new Uint8Array(64) });
    await publishFirmware(db, { manifest: m, keys: trustedKeys(`clear-route:${k.publicKey}`) });
    const got = await call('/api/device/point/firmware', { headers: auth });
    expect(got.status).toBe(200);
    expect(got.body).toEqual(m);
    expect(got.headers.get('cache-control')).toBe('no-store');
    expect((await call('/api/device/point/firmware')).status).toBe(401);
  });
});

describe('the fake Point, end to end', () => {
  test('claimed, activated, idle on its number, then Call lights it', async () => {
    const tables = (await call('/api/merchant/tables', { headers: as('jen') })).body.tables;
    const saved = await call('/api/merchant/tables', { method: 'PUT', headers: as('manager'), body: { tables: [...tables.map((t: { id: string; number: number; label: string | null; area: string | null; seats: number }) => ({ id: t.id, number: t.number, label: t.label, area: t.area, seats: t.seats })), { number: 9, label: null, area: null, seats: 4 }] } });
    expect(saved.status).toBe(200);
    const nine = (await call('/api/merchant/tables', { headers: as('jen') })).body.tables.find((t: { number: number }) => t.number === 9).id;
    await db.query(`INSERT INTO merchant.point_keys (code) VALUES ('N9N9')`);
    const claimed = await call('/api/merchant/points/claim', { headers: as('owner'), body: { code: 'N9N9' } });
    await call(`/api/merchant/hardware/${claimed.body.device.id}`, { method: 'PATCH', headers: as('owner'), body: { name: 'Table 9', point: { placement: 'table', tableId: nine } } });

    const proc = Bun.spawn(['bun', join(import.meta.dir, '../../../merchant/scripts/fake-point.ts'), '--api', base, '--code', 'N9N9', '--secret', claimed.body.provisioning.secret, '--health', '--firmware', `clear-route:${trustedKey}`, '--press', 'call', '--screens', '2'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const timer = setTimeout(() => proc.kill(), 15_000);
    const out = await new Response(proc.stdout).text();
    clearTimeout(timer);
    expect(await proc.exited).toBe(0);
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.event)).toEqual(['activated', 'health', 'firmware', 'state', 'pressed', 'state']);
    // The release published above, checked by the fake Point with the key it carries, as firmware will.
    expect(lines[2]).toEqual({ event: 'firmware', version: '1.0.4', verified: true });
    expect(lines[3].screen).toMatchObject({ code: 'N9N9', table: 'Table 9', state: { kind: 'idle', mode: 'number' }, lit: false });
    expect(lines[4].request).toMatchObject({ kind: 'call', state: 'open' });
    expect(lines[5].screen).toMatchObject({ state: { kind: 'called' }, lit: true });
    const health = (await call('/api/merchant/hardware', { headers: as('owner') })).body.find((d: { id: string }) => d.id === claimed.body.device.id).health;
    expect(health).toMatchObject({ batteryPercent: 82, firmware: '1.0.3', case: { kind: 'pay', buttons: 'ok' } });
  }, 20_000);
});

describe('the phone pages', () => {
  test('a held table is the menu, with no name and nothing cached', async () => {
    const page = await call(`/api/p/${point.code.toLowerCase()}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.body).toMatchObject({ code: 'T6T6', table: 'Table 6', view: 'pay_here' });
    expect(JSON.stringify(page.body)).not.toContain('Ana');
    expect(page.body.state).toBeUndefined();
  });

  test('unknown codes are 404, and a receipt code is never an order number', async () => {
    expect((await call('/api/p/ZZZZ')).status).toBe(404);
    expect((await call('/api/p/not-a-code')).status).toBe(404);
    expect((await call('/api/r/0000000142')).status).toBe(404);
  });

  test('paying with nothing on the Point says so', async () => {
    const r = await call(`/api/p/${point.code}/pay`, { body: { method: 'clear', idempotencyKey: 'route-pay-1' } });
    expect(r.status).toBe(409);
  });
});
