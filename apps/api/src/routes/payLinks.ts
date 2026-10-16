import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Role } from '@clear/merchant-contracts';
import { merchantDb } from '../config/merchantDb.js';
import type { Db } from '../db/db.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant } from '../middleware/merchantAuth.js';
import { limitByAddress } from '../middleware/rateLimiter.js';
import { TenderError } from '../services/merchant/cards/cardTenders.js';
import { connectorForShop } from '../services/merchant/cards/registry.js';
import { clearChargesFor } from '../services/merchant/orders/clearCharges.js';
import { OrderError, type OrderDeps } from '../services/merchant/orders/orderService.js';
import { PaymentError } from '../services/merchant/orders/payments.js';
import { createPaymentLink, deactivatePaymentLink, listPaymentLinks, PAY_STATUS, PayError, publicLink } from '../services/merchant/pay/links.js';
import { payInSession, paySessionView, startLinkSession, type PaySessionDeps } from '../services/merchant/pay/sessions.js';
import { staffStore } from '../services/merchant/staffStore.js';
import { defaultTaxApi } from '../services/merchant/tax/taxApi.js';

/**
 * Pay with Clear's links (pay spec §5). (`routes/pay.ts` is bill pay's, at `/api/pay`.)
 *
 * The merchant app, on /api/merchant (owners and managers):
 *   GET  /payment-links                  the shop's links, newest first
 *   POST /payment-links                  New charge › Send a link: an amount, or an item and a quantity
 *   POST /payment-links/:id/deactivate   turn one off for good
 *
 * The link page, no sign-in, counted by address:
 *   GET  /api/l/:slug                    the shop, what it comes to with tax, the note, the expiry
 *   POST /api/l/:slug/session            start paying: makes the link's order and its session
 *   GET  /api/checkout/:session          the session as it stands (polled while it waits)
 *   POST /api/checkout/:session/pay      {method, idempotencyKey}: a Clear charge, or a card checkout
 */

const pinCheck: OrderDeps['pinCheck'] = async (merchant, pin) => {
  const staff = await staffStore.signInWithPin(merchant, pin);
  return staff ? { id: staff.id, role: staff.role as Role } : null;
};

export interface PayRouteDeps {
  db: () => Promise<Db | null>;
  session: (db: Db) => PaySessionDeps;
  limits: { read: RequestHandler; act: RequestHandler };
}

export const defaultPayRouteDeps = (): PayRouteDeps => ({
  db: merchantDb,
  session: (db) => ({
    orders: { taxApi: defaultTaxApi(), pinCheck },
    clear: clearChargesFor(db),
    card: (merchant) => connectorForShop(db, merchant),
  }),
  limits: { read: limitByAddress('pay-pages', 60_000, 120), act: limitByAddress('pay-pages-act', 60_000, 10) },
});

function runWith(deps: PayRouteDeps, opts: { noStore: boolean }) {
  return (fn: (db: Db, req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    const db = await deps.db();
    if (!db) return res.status(503).json({ error: 'Unavailable', message: 'not available right now' });
    // A payment changes by the second; nothing here may be cached by a browser or a worker.
    if (opts.noStore) res.setHeader('Cache-Control', 'no-store');
    try {
      return res.json(await fn(db, req));
    } catch (error) {
      if (error instanceof PayError) return res.status(PAY_STATUS[error.code]).json({ error: error.code, message: error.message });
      if (error instanceof OrderError) return res.status(error.code === 'invalid' ? 422 : 409).json({ error: error.code, message: error.message });
      if (error instanceof PaymentError || error instanceof TenderError) return res.status(409).json({ error: error.code, message: error.message });
      throw error;
    }
  };
}

/** Mounted on the merchant router: links are made and turned off by owners and managers. */
export function merchantPayLinksRouter(deps: PayRouteDeps = defaultPayRouteDeps()): Router {
  const router = forwardAsyncErrors(Router());
  const run = runWith(deps, { noStore: false });
  const orders = (db: Db) => deps.session(db).orders;
  router.get('/payment-links', requireMerchant, requireManager, run((db, req) => listPaymentLinks(db, orders(db), req.merchant!.merchant)));
  router.post('/payment-links', requireMerchant, requireManager, run((db, req) =>
    createPaymentLink(db, orders(db), { merchant: req.merchant!.merchant, staffId: req.merchant!.staff.id, request: req.body }),
  ));
  router.post('/payment-links/:id/deactivate', requireMerchant, requireManager, run((db, req) =>
    deactivatePaymentLink(db, orders(db), { merchant: req.merchant!.merchant, staffId: req.merchant!.staff.id, id: String(req.params.id) }),
  ));
  return router;
}

/** `/api/l`: a link's page. */
export function linkPageRouter(deps: PayRouteDeps = defaultPayRouteDeps()): Router {
  const router = forwardAsyncErrors(Router());
  const run = runWith(deps, { noStore: true });
  router.use(deps.limits.read);
  router.get('/:slug', run((db, req) => publicLink(db, deps.session(db).orders, String(req.params.slug))));
  router.post('/:slug/session', deps.limits.act, run((db, req) => startLinkSession(db, deps.session(db), { slug: String(req.params.slug) })));
  return router;
}

/** `/api/checkout`: a payment-scoped session, from a link (and, in Phase 5, a website). */
export function checkoutRouter(deps: PayRouteDeps = defaultPayRouteDeps()): Router {
  const router = forwardAsyncErrors(Router());
  const run = runWith(deps, { noStore: true });
  router.use(deps.limits.read);
  router.get('/:session', run((db, req) => paySessionView(db, deps.session(db), { session: String(req.params.session) })));
  router.post('/:session/pay', deps.limits.act, run((db, req) => payInSession(db, deps.session(db), { session: String(req.params.session), request: req.body })));
  return router;
}
