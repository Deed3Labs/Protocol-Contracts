/**
 * End to end, live: the six Phase 10 scenarios over HTTP against the real API, a real Postgres, and
 * Stripe test mode with Stripe's own simulated reader (card-processing prompt, Phase 10). The same
 * stories run offline in src/services/merchant/e2e/scenarios.test.ts; this is the one that proves
 * our requests are ones Stripe accepts.
 *
 *   DATABASE_URL=postgres://…               an empty Postgres 16 (it's migrated here)
 *   STRIPE_SECRET_KEY=sk_test_…             Clear's platform TEST key (refused if it's live)
 *   E2E_STRIPE_ACCOUNT=acct_…               a test connected account the platform controls
 *   bun e2e/live.ts
 *
 * It boots the API itself on E2E_PORT (default 3999) with a local webhook secret, so the disconnect
 * is a signed `account.application.deauthorized` sent to our real endpoint: the connected account
 * isn't actually disconnected. Test mode only; it never touches live money.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.E2E_PORT || 3999);
const BASE = `http://localhost:${PORT}/api`;
const KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const ACCOUNT = (process.env.E2E_STRIPE_ACCOUNT || '').trim();
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const WEBHOOK_SECRET = 'whsec_e2e_local';

if (!KEY.startsWith('sk_test_')) throw new Error('STRIPE_SECRET_KEY must be a TEST key (sk_test_…)');
if (!ACCOUNT.startsWith('acct_')) throw new Error('E2E_STRIPE_ACCOUNT must name a test connected account');
if (!DATABASE_URL) throw new Error('DATABASE_URL must point at an empty Postgres');

const stripe = new Stripe(KEY);
const results: Array<{ scenario: string; ok: boolean; detail: string }> = [];
let n = 0;
const key = () => `e2e-live-${Date.now()}-${++n}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- The API, booted as it runs in production --------------------------------------------------
const server = spawn('bun', ['src/index.ts'], {
  cwd: API_DIR,
  env: {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    PORT: String(PORT),
    DATABASE_URL,
    POSTGRES_SSL_MODE: process.env.POSTGRES_SSL_MODE ?? 'disable',
    STRIPE_SECRET_KEY: KEY,
    STRIPE_CONNECT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    NODE_ENV: 'development',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

for (let i = 0; ; i++) {
  if (i > 60) throw new Error(`The API didn't come up:\n${serverLog.slice(-3000)}`);
  const up = await fetch(`${BASE}/merchant/cards/availability`).then((r) => r.status).catch(() => 0);
  if (up === 401) break;
  await sleep(1000);
}

// ---- Mike's Tire: the shop, its staff and their sessions, seeded through the real stores -------
process.env.DATABASE_URL = DATABASE_URL;
process.env.POSTGRES_SSL_MODE = process.env.POSTGRES_SSL_MODE ?? 'disable';
const { getMerchantPool } = await import('../src/config/merchantDb.js');
const { poolDb } = await import('../src/db/db.js');
const { staffStore } = await import('../src/services/merchant/staffStore.js');
const { sessionStore } = await import('../src/services/merchant/sessionStore.js');
const { connectorStore } = await import('../src/services/merchant/cards/connectorStore.js');
const db = poolDb(getMerchantPool()!);

const merchant = `0x${Date.now().toString(16).padStart(40, '0')}`;
await db.query(
  `INSERT INTO merchant.profiles (merchant, name, address_line1, address_city, address_region, address_postal_code) VALUES ($1, 'Mike''s Tire', '412 Colton Ave', 'Redlands', 'CA', '92374')`,
  [merchant],
);
const PINS = { owner: '9090', manager: '4321', jen: '1111', luis: '2222' };
const staff = {
  owner: (await staffStore.add({ merchant, name: 'Mike', role: 'owner', secret: PINS.owner }))!,
  manager: (await staffStore.add({ merchant, name: 'Dana', role: 'manager', secret: PINS.manager }))!,
  jen: (await staffStore.add({ merchant, name: 'Jen', role: 'counter', secret: PINS.jen }))!,
  luis: (await staffStore.add({ merchant, name: 'Luis', role: 'counter', secret: PINS.luis }))!,
};
const token = Object.fromEntries(await Promise.all(Object.entries(staff).map(async ([k, s]) => [k, (await sessionStore.create(s))!.token]))) as Record<keyof typeof staff, string>;
const cc = await connectorStore.insert(db, { merchant, provider: 'stripe', externalAccountId: ACCOUNT, connectedBy: staff.owner.id });
await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: ACCOUNT, chargesEnabled: true, detailsSubmitted: true, at: new Date() });

type Who = keyof typeof staff;
async function call<T = any>(who: Who, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${BASE}/merchant${path}`, {
    method,
    headers: { authorization: `Bearer ${token[who]}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as T };
}
async function ok<T = any>(who: Who, method: string, path: string, body?: unknown): Promise<T> {
  const r = await call<T>(who, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
function check(scenario: string, pass: boolean, detail: string) {
  results.push({ scenario, ok: pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${scenario}: ${detail}`);
}

// ---- The counter: a simulated smart reader, a tire in stock, the drawer open --------------------
const reader = await ok('manager', 'POST', '/cards/readers/smart', { registrationCode: 'simulated-wpe', label: 'Front counter (simulated)' });
// Exempt from tax so the run doesn't depend on Clear's Stripe Tax registrations.
const tire = await ok('manager', 'POST', '/catalog/items', { name: 'Michelin Defender2', detail: null, category: 'Tires', priceCents: 18900, costCents: 13200, taxKind: 'exempt', stockTracked: true, reorderAt: null });
await ok('manager', 'POST', '/catalog/stock', { itemId: tire.id, kind: 'receive', quantity: 8, reason: null });
let drawer = await ok('jen', 'POST', '/drawer', {});
const level = async () => (await db.query<{ on_hand: number; held: number }>('SELECT on_hand, held FROM commerce.stock_levels WHERE item_id = $1', [tire.id])).rows[0]!;

/** A card at the simulated reader: sent to it, presented (approved, or a declining test card), then synced. */
async function card(orderId: string, amountCents: number, opts: { decline?: boolean } = {}) {
  const start = await ok('jen', 'POST', `/orders/${orderId}/tenders/card`, { amountCents, tipCents: 0, readerId: reader.id, idempotencyKey: key() });
  await ok('jen', 'POST', `/tenders/${start.tenderId}/present`);
  await stripe.testHelpers.terminal.readers.presentPaymentMethod(
    reader.externalReaderId,
    { type: 'card_present', card_present: { number: opts.decline ? '4000000000000002' : '4242424242424242' } },
    { stripeAccount: ACCOUNT },
  );
  for (let i = 0; i < 20; i++) {
    const t = await ok('jen', 'POST', `/tenders/${start.tenderId}/sync`);
    if (t.status !== 'pending') return t;
    await sleep(1000);
  }
  throw new Error(`Tender ${start.tenderId} never left pending`);
}
const order = (lines: unknown[]) => ok('jen', 'POST', '/orders', { lines });
const labour = (name: string, amountCents: number) => ({ itemId: null, name, note: null, amountCents, taxKind: 'labour' });

try {
  // 1. A split sale whose card part is declined.
  {
    const o = await order([labour('Brake job', 15000)]);
    await ok('jen', 'POST', `/orders/${o.id}/tenders/cash`, { amountCents: 5000, tipCents: 0, handedOverCents: 5000, idempotencyKey: key() });
    const declined = await card(o.id, 10000, { decline: true });
    const mid = await ok('jen', 'GET', `/orders/${o.id}`);
    const good = await card(o.id, 10000);
    const end = await ok('jen', 'GET', `/orders/${o.id}`);
    check('split sale, card declined', declined.status === 'declined' && mid.remainingCents === 10000 && mid.status === 'paying' && good.status === 'authorised' && end.status === 'paid', `declined=${declined.status}, owed after=${mid.remainingCents}, retry=${good.status}, order=${end.status}`);
  }

  // 2. Void before close.
  {
    const o = await order([{ itemId: tire.id, quantity: 1, optionIds: [] }]);
    const t = await card(o.id, o.totalCents);
    const before = await level();
    const refused = await call('jen', 'POST', `/orders/${o.id}/void`, { pin: PINS.jen });
    const voided = await ok('jen', 'POST', `/orders/${o.id}/void`, { pin: PINS.manager });
    const { rows } = await db.query<{ payment_intent_id: string }>('SELECT payment_intent_id FROM payments.tenders WHERE id = $1', [t.id]);
    const pi = await stripe.paymentIntents.retrieve(rows[0]!.payment_intent_id, {}, { stripeAccount: ACCOUNT });
    const after = await level();
    check('void before close', refused.status >= 400 && voided.status === 'voided' && pi.status === 'canceled' && after.on_hand === before.on_hand + 1, `counter PIN → ${refused.status}; manager → ${voided.status}; Stripe PI ${pi.status}; tire back on shelf ${before.on_hand}→${after.on_hand}`);
  }

  // 3. A tip added after the tap, before close.
  let tipped: { id: string } | null = null;
  {
    const o = await order([labour('Mount and balance', 10000)]);
    const t = await card(o.id, 10000);
    const r = await call('jen', 'POST', `/tenders/${t.id}/tip`, { tipCents: 1500 });
    tipped = t;
    const { rows } = await db.query<{ payment_intent_id: string }>('SELECT payment_intent_id FROM payments.tenders WHERE id = $1', [t.id]);
    const pi = await stripe.paymentIntents.retrieve(rows[0]!.payment_intent_id, {}, { stripeAccount: ACCOUNT });
    check(
      'tip adjusted before close',
      r.status === 200 ? pi.amount_capturable === 11500 : r.status === 422 && (r.body as any)?.error === 'tip_not_raisable',
      r.status === 200 ? `hold raised to ${pi.amount_capturable}` : `refused cleanly: ${(r.body as any)?.message}`,
    );
  }

  // 4. A card sale of two tires, captured at close, then one refunded with restock (below).
  const two = await order([{ itemId: tire.id, quantity: 2, optionIds: [] }]);
  const twoCard = await card(two.id, two.totalCents);

  // 5. A short drawer: two blind counts $5 short, sign-off, close (which captures the cards).
  {
    const expected = 15000 + 5000; // the float, and the split sale's cash
    for (const who of ['jen', 'luis'] as const) await ok(who, 'POST', `/drawer/${drawer.id}/counts`, { method: 'total', totalCents: expected - 500 });
    const blocked = await call('luis', 'POST', `/drawer/${drawer.id}/close`);
    await ok('luis', 'POST', `/drawer/${drawer.id}/signoff`, { note: 'Gave $5 too much change', pin: PINS.manager });
    const closed = await ok('luis', 'POST', `/drawer/${drawer.id}/close`);
    const { rows } = await db.query<{ status: string; payment_intent_id: string }>(`SELECT status, payment_intent_id FROM payments.tenders WHERE merchant = $1 AND method = 'card' AND status IN ('captured','authorised')`, [merchant]);
    const stripeStates = await Promise.all(rows.map((r) => stripe.paymentIntents.retrieve(r.payment_intent_id, {}, { stripeAccount: ACCOUNT }).then((p) => p.status)));
    check(
      'short drawer through sign-off and close',
      blocked.status === 409 && closed.report.drawer.differenceCents === -500 && closed.report.drawer.signedOffBy === staff.manager.id && closed.captureFailures.length === 0 && stripeStates.every((s) => s === 'succeeded'),
      `close before sign-off → ${blocked.status}; difference ${closed.report.drawer.differenceCents}, signed by manager; captured at Stripe: ${stripeStates.join(', ')}`,
    );
  }

  // 4, continued. A partial refund of goods with restock, after capture.
  {
    const before = await level();
    const line = two.lines[0];
    const refund = await ok('manager', 'POST', '/tender-refunds', { tenderId: twoCard.id, amountCents: 18900, items: [{ orderLineId: line.id, quantity: 1, backInStock: true }], reason: 'Wrong size', idempotencyKey: key() });
    const after = await level();
    const { rows } = await db.query<{ external_refund_id: string }>('SELECT external_refund_id FROM payments.refunds WHERE id = $1', [refund.id]);
    const re = await stripe.refunds.retrieve(rows[0]!.external_refund_id, {}, { stripeAccount: ACCOUNT });
    check('partial refund of goods with restock', refund.status === 'succeeded' && re.amount === 18900 && re.status === 'succeeded' && after.on_hand === before.on_hand + 1, `refund ${refund.status}; Stripe refunded ${re.amount} (${re.status}); stock ${before.on_hand}→${after.on_hand}`);
  }

  // 6. The merchant disconnects Stripe mid-day, with a card authorised and not yet captured.
  {
    drawer = await ok('jen', 'POST', '/drawer', {});
    const o = await order([labour('Alignment', 9000)]);
    const t = await card(o.id, 9000);
    const payload = JSON.stringify({ id: `evt_e2e_deauth_${Date.now()}`, object: 'event', type: 'account.application.deauthorized', account: ACCOUNT, created: Math.floor(Date.now() / 1000), livemode: false, data: { object: { id: 'ca_e2e', object: 'application' } } });
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: WEBHOOK_SECRET });
    const hook = await fetch(`${BASE}/stripe/webhooks/connect`, { method: 'POST', headers: { 'stripe-signature': signature, 'content-type': 'application/json' }, body: payload });
    let avail: any = null;
    for (let i = 0; i < 10; i++) {
      avail = await ok('jen', 'GET', '/cards/availability');
      if (!avail.available) break;
      await sleep(500);
    }
    const o2 = await order([labour('Rotation', 4000)]);
    const refusedCard = await call('jen', 'POST', `/orders/${o2.id}/tenders/card`, { amountCents: 4000, tipCents: 0, readerId: reader.id, idempotencyKey: key() });
    await ok('jen', 'POST', `/orders/${o2.id}/tenders/cash`, { amountCents: 4000, tipCents: 0, handedOverCents: 4000, idempotencyKey: key() });
    for (const who of ['jen', 'luis'] as const) await ok(who, 'POST', `/drawer/${drawer.id}/counts`, { method: 'total', totalCents: 15000 + 4000 });
    const closed = await ok('luis', 'POST', `/drawer/${drawer.id}/close`);
    const { rows } = await db.query<{ payment_intent_id: string }>('SELECT payment_intent_id FROM payments.tenders WHERE id = $1', [t.id]);
    const pi = await stripe.paymentIntents.retrieve(rows[0]!.payment_intent_id, {}, { stripeAccount: ACCOUNT });
    const stranded = closed.captureFailures.find((f: { tenderId: string }) => f.tenderId === t.id);
    check(
      'disconnect mid-day',
      hook.status === 200 && avail.available === false && refusedCard.status === 409 && stranded?.error?.includes('Stripe Dashboard') && pi.status === 'requires_capture',
      `webhook ${hook.status}; cards ${avail.available ? 'still open' : `locked (${avail.reason})`}; new card → ${refusedCard.status}; cash taken; close named the stranded card; Stripe PI left ${pi.status}`,
    );
    // Tidy the test account: release the hold Clear can no longer reach.
    await stripe.paymentIntents.cancel(rows[0]!.payment_intent_id, {}, { stripeAccount: ACCOUNT }).catch(() => undefined);
  }

  // The audit trail saw all of it.
  const audit = await ok('owner', 'GET', `/audit?from=${new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}&to=${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}`);
  const actions = new Set((audit as Array<{ action: string }>).map((e) => e.action));
  const needed = ['card.declined', 'order.voided', 'card.tip_adjusted', 'drawer.signed_off', 'day.closed', 'refund.card_succeeded', 'booked.drawer_short'];
  check('audit trail', needed.every((a) => actions.has(a)) || (!actions.has('card.tip_adjusted') && needed.filter((a) => a !== 'card.tip_adjusted').every((a) => actions.has(a))), `${audit.length} rows; ${needed.map((a) => `${a}:${actions.has(a) ? '✓' : '✗'}`).join(' ')}`);
  void tipped;
} finally {
  stop();
  await getMerchantPool()?.end();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(serverLog.split('\n').filter((l) => /error|fail/i.test(l)).slice(-20).join('\n'));
  process.exit(1);
}
