/**
 * Staff PINs end to end, over HTTP against the real API and Postgres: someone added in Staff picks
 * their PIN on their first shift, a PIN somebody else has is refused, a manager resets a counter
 * PIN, and a removed person's shift stops.
 *
 *   DATABASE_URL=postgres://…         an empty Postgres 16
 *   bun e2e/staff.ts
 */
import { bootApi, PINS, seedShop } from './harness.js';

const PORT = Number(process.env.E2E_PORT || 3997);
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
if (!DATABASE_URL) throw new Error('DATABASE_URL must point at an empty Postgres');

const api = await bootApi({ port: PORT, databaseUrl: DATABASE_URL, stripeKey: null });
const shop = await seedShop({ databaseUrl: DATABASE_URL, stripeAccount: null });
const { deviceStore } = await import('../src/services/merchant/deviceStore.js');
const device = (await deviceStore.enroll({ merchant: shop.merchant, label: 'Counter tablet', enrolledBy: shop.staff.owner.id }))!.token;

let failed = 0;
const check = (what: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${what}${detail ? `: ${detail}` : ''}`);
};
async function call(method: string, path: string, opts: { token?: string; device?: boolean; body?: unknown } = {}) {
  const r = await fetch(`${api.base}/merchant${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.device ? { 'x-clear-device': device } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

try {
  const { token } = shop;

  // Added in Staff, with no PIN: the roster says so.
  const added = await call('POST', '/staff', { token: token.manager, body: { name: 'Ana Ruiz', role: 'counter', secret: '' } });
  check('a manager adds counter staff', added.status === 201, JSON.stringify(added.body));
  const ana = added.body.id as string;
  const roster = await call('POST', '/roster', { device: true, body: {} });
  const row = roster.body.staff.find((s: { id: string }) => s.id === ana);
  check('the roster marks her first shift', row?.pinSet === false && roster.body.staff.some((s: { pinSet: boolean }) => s.pinSet));

  // She can't start a shift with a PIN she hasn't set.
  check('no shift before a PIN is set', (await call('POST', '/session', { device: true, body: { staffId: ana, pin: '5555' } })).status === 401);

  // A PIN somebody else has is refused, without saying whose.
  const taken = await call('POST', `/staff/${ana}/first-pin`, { device: true, body: { pin: PINS.manager } });
  check('a PIN somebody has is refused', taken.status === 409 && !/Dana|manager/i.test(JSON.stringify(taken.body)), JSON.stringify(taken.body));

  // Her own four digits: set, and her shift starts.
  const first = await call('POST', `/staff/${ana}/first-pin`, { device: true, body: { pin: '5555' } });
  check('her first shift starts with the PIN she picked', first.status === 200 && first.body.staff?.id === ana && !!first.body.token);
  check('her session works', (await call('GET', '/profile', { token: first.body.token })).status === 200);
  const onNow = await call('GET', '/shifts', { token: first.body.token });
  check('her first PIN puts her on shift', onNow.status === 200 && onNow.body.some((x: { staffId: string }) => x.staffId === ana), JSON.stringify(onNow.body));
  check('the PIN can’t be picked twice', (await call('POST', `/staff/${ana}/first-pin`, { device: true, body: { pin: '6666' } })).status === 409);
  check('the next shift is a normal sign-in', (await call('POST', '/session', { device: true, body: { staffId: ana, pin: '5555' } })).status === 200);

  // Resetting: counter staff can't; a manager can, confirming with their own PIN.
  check('counter staff can’t reset a PIN', (await call('POST', `/staff/${ana}/reset-pin`, { token: token.jen, body: { approverPin: PINS.jen } })).status === 403);
  check('a manager can’t reset an owner', (await call('POST', `/staff/${shop.staff.owner.id}/reset-pin`, { token: token.manager, body: { approverPin: PINS.manager } })).status === 403);
  check('a wrong confirming PIN is refused', (await call('POST', `/staff/${ana}/reset-pin`, { token: token.manager, body: { approverPin: '0000' } })).status === 401);
  const reset = await call('POST', `/staff/${ana}/reset-pin`, { token: token.manager, body: { approverPin: PINS.manager } });
  check('a manager resets a counter PIN', reset.status === 200 && reset.body.pinSet === false);
  check('the old PIN stops working', (await call('POST', '/session', { device: true, body: { staffId: ana, pin: '5555' } })).status === 401);
  check('she picks a new one next shift', (await call('POST', `/staff/${ana}/first-pin`, { device: true, body: { pin: '7777' } })).status === 200);

  // Removing: her shift stops on its next request, and she's off the roster.
  const shift = (await call('POST', '/session', { device: true, body: { staffId: ana, pin: '7777' } })).body.token as string;
  check('a manager can’t remove a manager', (await call('DELETE', `/staff/${shop.staff.manager.id}`, { token: token.manager })).status === 403);
  check('nobody removes themselves', (await call('DELETE', `/staff/${shop.staff.owner.id}`, { token: token.owner })).status === 403);
  check('the owner removes her', (await call('DELETE', `/staff/${ana}`, { token: token.owner })).status === 200);
  check('her shift stops', (await call('GET', '/profile', { token: shift })).status === 401);
  const stillOn = await call('GET', '/shifts', { token: token.owner });
  check('removing her ends her shift', stillOn.status === 200 && !stillOn.body.some((x: { staffId: string }) => x.staffId === ana), JSON.stringify(stillOn.body));
  const after = await call('POST', '/roster', { device: true, body: {} });
  check('she’s off the roster', !after.body.staff.some((s: { id: string }) => s.id === ana));
  const trail = await call('GET', `/audit?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, { token: token.owner });
  const actions = (trail.body as Array<{ action: string }>).map((e) => e.action);
  check('the audit trail has the reset and the removal', actions.includes('staff.pin_reset') && actions.includes('staff.removed'), actions.join(', '));
} catch (e) {
  failed++;
  console.error(e, '\n', api.log().slice(-2000));
} finally {
  api.stop();
  await shop.end();
}
console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exit(failed ? 1 : 0);
