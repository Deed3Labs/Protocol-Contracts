/**
 * The link page's API on this machine, with no Postgres and no chain: an in-process database (PGlite,
 * the tests' own) seeded with Mi Casa Tacos and the spec's link, and a pretend Clear whose member
 * approves a charge a few seconds after it's raised. For running apps/pay against the real routes.
 *
 *   bun scripts/pay-dev.ts            then open http://localhost:5195/l/micasa-tray12
 *
 * Development only: it refuses to start with NODE_ENV=production.
 */
import cors from 'cors';
import express from 'express';
import { seedShop, testDb } from '../src/db/testDb.js';
import { checkoutRouter, linkPageRouter, type PayRouteDeps } from '../src/routes/payLinks.js';
import * as catalog from '../src/services/merchant/catalog/catalogService.js';
import type { OrderDeps } from '../src/services/merchant/orders/orderService.js';
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
const APPROVE_AFTER_MS = Number(process.env.APPROVE_AFTER_MS || 6000);
// The Clear tab opens a stand-in here, not app.useclear.org.
process.env.APP_PUBLIC_URL ||= `http://localhost:${PORT}/dev-clear`;

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
app.get('/dev-clear/c/:code', (req, res) => {
  res.type('html').send(
    `<!doctype html><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:24px">` +
      `<p>The Clear app's approval, pretended: charge ${String(req.params.code).replace(/[^A-Z0-9]/g, '')} is approved ${APPROVE_AFTER_MS / 1000}s after it was raised.</p><p>Go back to the link's tab.</p>`,
  );
});
app.listen(PORT, () => console.log(`pay-dev on http://localhost:${PORT}: /api/l/micasa-tray12 (a charge is approved ${APPROVE_AFTER_MS / 1000}s after it's raised)`));
