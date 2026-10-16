/**
 * The link page's and the modal's API on this machine, with no Postgres and no chain: an in-process
 * database (PGlite, the tests' own) seeded with Mi Casa Tacos and the spec's link, and a pretend Clear
 * whose member approves a charge a few seconds after it's raised. For running apps/pay against the
 * real routes.
 *
 *   bun scripts/pay-dev.ts            then open http://localhost:5195/l/micasa-tray12
 *                                     or the shop's page, http://localhost:5199, for the modal in
 *                                     test mode: the test member is (555) 010-0100, code 000000
 *
 * Development only: it refuses to start with NODE_ENV=production.
 */
import cors from 'cors';
import express from 'express';
import { seedShop, testDb } from '../src/db/testDb.js';
import { checkoutRouter, linkPageRouter, type PayRouteDeps } from '../src/routes/payLinks.js';
import { v1Cors, v1Errors, v1Router } from '../src/routes/v1.js';
import * as catalog from '../src/services/merchant/catalog/catalogService.js';
import type { OrderDeps } from '../src/services/merchant/orders/orderService.js';
import { addSite, createKeys } from '../src/services/merchant/pay/keys.js';
import { ensureShopApp, patchShopApp } from '../src/services/merchant/rewards/shopApp.js';
import { type ClearCharges, syncClearTender } from '../src/services/merchant/orders/payments.js';

if (process.env.NODE_ENV === 'production') {
  console.error('pay-dev is for development only');
  process.exit(1);
}

// The API's modules start a Redis client on import, and there's no Redis here: its connection
// errors would end the process. Only those are let go; anything else still stops it.
const redisNoise = (e: unknown) => /redis|reconnection attempts|ECONNREFUSED/i.test(`${(e as Error)?.message ?? ''} ${(e as { code?: string })?.code ?? ''}`);
process.on('uncaughtException', (e) => {
  if (!redisNoise(e)) throw e;
});
process.on('unhandledRejection', (e) => {
  if (!redisNoise(e)) throw e;
});

const PORT = Number(process.env.PORT || 3001);
const SHOP_PORT = Number(process.env.SHOP_PORT || 5199);
const PAY_ORIGIN = process.env.PAY_ORIGIN || 'http://localhost:5195';
const APPROVE_AFTER_MS = Number(process.env.APPROVE_AFTER_MS || 6000);
// The Clear tab opens a stand-in here, not app.useclear.org.
process.env.APP_PUBLIC_URL ||= `http://localhost:${PORT}/dev-clear`;
// The modal's frame comes from this machine's apps/pay.
process.env.PAY_BASE_URL ||= PAY_ORIGIN;

const { db } = await testDb();
const shop = await seedShop(db);
await db.query(
  `UPDATE merchant.profiles SET name = 'Mi Casa Tacos', address_line1 = '201 E State St', address_city = 'Redlands', address_region = 'CA', address_postal_code = '92373',
     address_country = 'US', tax_rates = $2, tax_rates_address = '201 e state st|redlands|ca|92373|us', timezone = 'America/Los_Angeles' WHERE merchant = $1`,
  [shop.merchant, JSON.stringify({ food: 83750, goods: 83750, labour: null })],
);
const tray = await catalog.createItem(db, {
  merchant: shop.merchant,
  staffId: shop.staff.owner,
  item: { name: 'Taco tray for 12', detail: null, category: 'Catering', priceCents: 14900, costCents: null, taxKind: 'food', stockTracked: false, reorderAt: null },
});
// The spec's own address for it, rather than a random one.
await db.query(
  `INSERT INTO payments.payment_links (id, merchant, slug, item_id, quantity, note, expires_at, allow_over_time, created_by)
   VALUES ('plink_dev', $1, 'micasa-tray12', $2, 1, 'Saturday pickup, 11:30am', now() + interval '7 days', true, $3)`,
  [shop.merchant, tray.id, shop.staff.owner],
);

// The modal: test keys, the shop's page as an allowed website, and its app at 1.5× for Clear.
const { secret: testSecret } = await createKeys(db, { merchant: shop.merchant, staffId: shop.staff.owner, livemode: false });
const { rows: pk } = await db.query<{ token: string }>(`SELECT token FROM payments.api_keys WHERE merchant = $1 AND kind = 'publishable' AND NOT livemode`, [shop.merchant]);
await addSite(db, { merchant: shop.merchant, staffId: shop.staff.owner, request: { site: `http://localhost:${SHOP_PORT}` } });
await ensureShopApp(db, shop.merchant, shop.staff.owner);
await patchShopApp(db, shop.merchant, shop.staff.owner, {
  slug: 'micasa',
  enabled: true,
  rules: { unit: 'dollars', pointsPer: 1, perAmountCents: 100, visitMinCents: 0, cardSize: 10, keepTheChange: false, clearMultiplier: 1.5, boosts: [], joinBonus: 0, birthdayRewardId: null, referralBonus: null, expiry: 'never' },
});

const raisedAt = new Map<string, number>();
let n = 0;
const clear: ClearCharges = {
  async raise() {
    const code = `DEV${(++n).toString().padStart(5, '0')}`;
    raisedAt.set(code, Date.now());
    return { ok: true, code };
  },
  async status(code) {
    const at = raisedAt.get(code);
    if (at === undefined) return null;
    return Date.now() - at >= APPROVE_AFTER_MS ? 'approved' : 'pending';
  },
  async cancel() {
    return true;
  },
  async sendTo() {
    return { ok: true, label: 'their Clear app' };
  },
};

// The counter's sweep, every second: a charge the pretend member approved settles its tender.
setInterval(async () => {
  const { rows } = await db.query<{ id: string; merchant: string }>(`SELECT id, merchant FROM payments.tenders WHERE method = 'clear' AND status = 'pending'`);
  for (const t of rows) await syncClearTender(db, clear, { merchant: t.merchant, tenderId: t.id, actor: null }).catch(() => undefined);
}, 1000);

const orders: OrderDeps = { taxApi: null, pinCheck: async () => null };
const pass: express.RequestHandler = (_req, _res, next) => next();
const deps: PayRouteDeps = { db: async () => db, session: () => ({ orders, clear, card: async () => null }), limits: { read: pass, act: pass } };

const app = express();
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
app.use(express.json());
app.use('/api/l', linkPageRouter(deps));
app.use('/api/checkout', checkoutRouter(deps));
app.use('/v1', v1Cors);
app.use('/v1', v1Router({ db: async () => db, v1: () => ({ orders, refunds: async () => ({ card: null, pinCheck: async () => null }) }), limit: pass }));
app.use('/v1', v1Errors);
app.get('/dev-clear/c/:code', (req, res) => {
  res.type('html').send(
    `<!doctype html><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:24px">` +
      `<p>The Clear app's approval, pretended: charge ${String(req.params.code).replace(/[^A-Z0-9]/g, '')} is approved ${APPROVE_AFTER_MS / 1000}s after it was raised.</p><p>Go back to the link's tab.</p>`,
  );
});
app.listen(PORT, () => console.log(`pay-dev on http://localhost:${PORT}: /api/l/micasa-tray12 (a charge is approved ${APPROVE_AFTER_MS / 1000}s after it's raised)`));

// The shop's own page, micasatacos.com as drawn in the spec's §1: its server makes the payment with
// the secret key (the amount never comes from the browser), the page hands the script its clientSecret.
const shopSite = express();
let orderNo = 1041;
shopSite.post('/payment', async (_req, res) => {
  const r = await fetch(`http://localhost:${PORT}/v1/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${testSecret}`, 'Content-Type': 'application/json', 'Idempotency-Key': `dev-${Date.now()}` },
    body: JSON.stringify({
      amount: 18532,
      currency: 'usd',
      reference: `catering-${++orderNo}`,
      lines: [
        { name: 'Taco tray for 12', amount: 14900 },
        { name: 'Agua fresca, gallon', amount: 1100, quantity: 2 },
      ],
    }),
  });
  const body = (await r.json()) as { clientSecret?: string };
  res.status(r.status).json({ clientSecret: body.clientSecret ?? null });
});
shopSite.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mi Casa Tacos · Checkout</title>
<style>
  body { margin: 0; font: 16px/1.5 Georgia, serif; background: #f6efe4; color: #2b1d14; }
  header { padding: 18px 24px; border-bottom: 1px solid #e3d5c2; font-weight: 700; letter-spacing: .02em; }
  main { max-width: 560px; margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-size: 28px; margin: 0 0 20px; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eadfcf; }
  .total { font-weight: 700; border-bottom: 0; }
  button { margin-top: 24px; width: 100%; padding: 14px; font: inherit; font-weight: 700; color: #fff; background: #b4532a; border: 0; border-radius: 6px; cursor: pointer; }
  pre { margin-top: 24px; padding: 16px; background: #fff; border: 1px solid #e3d5c2; white-space: pre-wrap; font-size: 13px; }
  pre:empty { display: none; }
</style></head>
<body><header>Mi Casa Tacos</header>
<main>
  <h1>Your catering order</h1>
  <div class="row"><span>Taco tray for 12</span><span>$149.00</span></div>
  <div class="row"><span>Agua fresca, gallon × 2</span><span>$22.00</span></div>
  <div class="row"><span>Tax</span><span>$14.32</span></div>
  <div class="row total"><span>Total</span><span>$185.32</span></div>
  <button id="pay" type="button">Pay with Clear</button>
  <pre id="result"></pre>
</main>
<script src="${PAY_ORIGIN}/js/v1.js"></script>
<script>
  const result = document.getElementById('result');
  fetch('/payment', { method: 'POST' }).then((r) => r.json()).then(({ clientSecret }) => {
    Clear(${JSON.stringify(pk[0]!.token)}, { apiBase: 'http://localhost:${PORT}', payOrigin: ${JSON.stringify(PAY_ORIGIN)} }).attach('#pay', { payment: clientSecret }, {
      accent: '#B4532A',
      // What the page is given, exactly.
      onSuccess: (p) => { result.textContent = 'onSuccess ' + JSON.stringify(p, null, 2); },
      onCancel: () => { result.textContent = 'onCancel'; },
      onError: (e) => { result.textContent = 'onError ' + JSON.stringify(e); },
    });
  });
</script>
</body></html>`);
});
shopSite.listen(SHOP_PORT, () => console.log(`the shop's page on http://localhost:${SHOP_PORT} (test mode: (555) 010-0100, code 000000)`));
