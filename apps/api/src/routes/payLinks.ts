import { Router, type Request, type RequestHandler, type Response } from 'express';
import { pasteInPrompt, type DevelopersView, type Role } from '@clear/merchant-contracts';
import { merchantDb } from '../config/merchantDb.js';
import type { Db } from '../db/db.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireAuth } from '../middleware/auth.js';
import { requireManager, requireMerchant } from '../middleware/merchantAuth.js';
import { limitByAddress } from '../middleware/rateLimiter.js';
import { TenderError } from '../services/merchant/cards/cardTenders.js';
import { connectorForShop } from '../services/merchant/cards/registry.js';
import { clearChargesFor } from '../services/merchant/orders/clearCharges.js';
import { OrderError, type OrderDeps } from '../services/merchant/orders/orderService.js';
import { PaymentError } from '../services/merchant/orders/payments.js';
import { addSite, createKeys, listKeys, listSites, removeSite, rollSecretKey } from '../services/merchant/pay/keys.js';
import { cardsOn, createPaymentLink, deactivatePaymentLink, listPaymentLinks, PAY_STATUS, PayError, publicLink } from '../services/merchant/pay/links.js';
import { addEndpointFromApp, deleteEndpoint, merchantEndpoints, recentDeliveries } from '../services/merchant/pay/webhooks.js';
import { approvalPage, approvalView, approveInFrame, claimsFrom, frameOrigin, frameStatus, memberQuote, sendContact, TOKEN_HEADER, verifyCode, type FrameDeps } from '../services/merchant/pay/frame.js';
import { finishJoin, joinState, joinWindow, startJoin } from '../services/merchant/pay/join.js';
import { registerWalletDomains, startCard } from '../services/merchant/pay/card.js';
import { defaultFrameDeps } from '../services/merchant/pay/payDeps.js';
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
  /** The modal's sign-in and approvals; the session's deps with Clear's members, texts and chain. */
  frame?: (db: Db) => FrameDeps;
  limits: { read: RequestHandler; act: RequestHandler };
  /** The Clear window's member session (Privy), for joining's hand-back. requireAuth unless a test says. */
  memberAuth?: RequestHandler;
}

export const defaultPayRouteDeps = (): PayRouteDeps => ({
  db: merchantDb,
  session: (db) => ({
    orders: { taxApi: defaultTaxApi(), pinCheck },
    clear: clearChargesFor(db),
    card: (merchant) => connectorForShop(db, merchant),
  }),
  frame: (db) => defaultFrameDeps(db, { taxApi: defaultTaxApi(), pinCheck }),
  limits: { read: limitByAddress('pay-pages', 60_000, 120), act: limitByAddress('pay-pages-act', 60_000, 10) },
});

function runWith(deps: PayRouteDeps, opts: { noStore: boolean }) {
  return (fn: (db: Db, req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    const db = await deps.db();
    if (!db) return res.status(503).json({ error: 'Unavailable', message: 'not available right now' });
    // A payment changes by the second; nothing here may be cached by a browser or a worker.
    if (opts.noStore) res.setHeader('Cache-Control', 'no-store');
    try {
      const out = await fn(db, req);
      if (out === undefined) return res.status(204).end();
      return res.json(out);
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

  // Settings › Developers (pay spec §6): owners and managers; the counter never sees it.
  const who = (req: Request) => ({ merchant: req.merchant!.merchant, staffId: req.merchant!.staff.id });
  router.get('/developers', requireMerchant, requireManager, run((db, req) => developersView(db, req.merchant!.merchant)));
  router.post('/developers/keys', requireMerchant, requireManager, run((db, req) => createKeys(db, { ...who(req), livemode: req.body?.livemode === true })));
  router.post('/developers/keys/:id/roll', requireMerchant, requireManager, run((db, req) => rollSecretKey(db, { ...who(req), keyId: String(req.params.id) })));
  router.post('/developers/sites', requireMerchant, requireManager, run(async (db, req) => {
    const site = await addSite(db, { ...who(req), request: req.body });
    // Wallets in the card fields need the site's domain on the shop's account; it doesn't hold this up.
    void connectorForShop(db, req.merchant!.merchant)
      .then((provider) => registerWalletDomains(db, provider, { merchant: req.merchant!.merchant, origin: site.origin }))
      .catch(() => undefined);
    return site;
  }));
  router.delete('/developers/sites', requireMerchant, requireManager, run(async (db, req) => {
    await removeSite(db, { ...who(req), origin: String(req.query.origin ?? '') });
    return undefined;
  }));
  router.post('/developers/webhook-endpoints', requireMerchant, requireManager, run((db, req) => addEndpointFromApp(db, { ...who(req), request: req.body })));
  router.delete('/developers/webhook-endpoints/:id', requireMerchant, requireManager, run(async (db, req) => {
    await deleteEndpoint(db, { merchant: req.merchant!.merchant, id: String(req.params.id), staffId: req.merchant!.staff.id });
    return undefined;
  }));
  return router;
}

/** Settings › Developers, both modes: the pane's Test/Live switch only chooses what it shows. */
export async function developersView(db: Db, merchant: string): Promise<DevelopersView> {
  const keys = await listKeys(db, merchant);
  const publishable = (livemode: boolean) => keys.find((k) => k.kind === 'publishable' && k.livemode === livemode && !k.rolledAt)?.token;
  return {
    keys,
    sites: await listSites(db, merchant),
    endpoints: await merchantEndpoints(db, merchant),
    deliveries: await recentDeliveries(db, merchant),
    // Testing's test card: only where a test-mode payment can take a card (never on a live key).
    cardsConnected: await cardsOn(db, merchant, false),
    ai: { llmsUrl: 'https://useclear.org/llms.txt', prompt: pasteInPrompt(publishable(true) ?? publishable(false) ?? 'clear_pk_test_…'), mcpUrl: 'https://useclear.org/docs/mcp.md' },
  };
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

/**
 * `/api/checkout`: a payment-scoped session, from a link or a website (the modal).
 *
 *   GET  /approval/:id          the approval page's read (the Clear app, app.useclear.org/approve/:id)
 *   GET  /:session              what the page or the frame shows
 *   GET  /:session/frame        which website may frame it (apps/pay's frame-ancestors)
 *   POST /:session/pay          {method, idempotencyKey}: a Clear charge, or a card checkout
 *   POST /:session/contact      {contact}: a code and a link, the same for everyone
 *   POST /:session/code         {code}: a token for this payment (X-Pay-Session)
 *   GET  /:session/status       where it stands, polled while a screen waits
 *   GET  /:session/member       Hi Sofia: the choices and their figures (X-Pay-Session)
 *   POST /:session/approve      over time, in the frame (X-Pay-Session)
 *   POST /:session/approval     the approval page's address, for window.open
 *   POST /:session/card         {idempotencyKey}: Stripe's fields' PaymentIntent (X-Pay-Session when signed in)
 *   POST /:session/join         step 1 of joining (a new person's X-Pay-Session): the window's address
 *   GET  /:session/join         polled while the window is open; a member's token once it's done
 *   GET  /join/:handoff         the Clear window: the shop and the contact; step 1 too when signed in as it
 *   POST /join/:handoff/done    the Clear window, signed in: joined; the starting term limit
 */
export function checkoutRouter(deps: PayRouteDeps = defaultPayRouteDeps()): Router {
  const router = forwardAsyncErrors(Router());
  const run = runWith(deps, { noStore: true });
  const frame = (db: Db) => (deps.frame ?? ((d: Db) => defaultFrameDeps(d, deps.session(d).orders)))(db);
  const token = (req: Request) => req.header(TOKEN_HEADER) ?? undefined;
  const session = (req: Request) => String(req.params.session);
  // The member's wallet comes from their verified session, never from the request.
  const memberWallet = (req: Request) => String(req.auth?.smartWallet || req.auth?.walletAddress || '').trim().toLowerCase();
  const memberAuth = deps.memberAuth ?? requireAuth;
  const who = (req: Request) => ({ phone: req.auth?.phone ?? null, emails: [...(req.auth?.emails ?? []), ...(req.auth?.email ? [req.auth.email] : [])] });
  router.use(deps.limits.read);
  // Signed out it answers too (the window's first screen); with a bearer token it must be a good one.
  const optionalMemberAuth: RequestHandler = (req, res, next) => (req.header('authorization') ? memberAuth(req, res, next) : next());
  router.get('/join/:handoff', optionalMemberAuth, run((db, req) => joinWindow(db, deps.session(db), { handoff: String(req.params.handoff), who: req.auth ? who(req) : null })));
  router.post('/join/:handoff/done', memberAuth, deps.limits.act, run((db, req) => finishJoin(db, frame(db), { handoff: String(req.params.handoff), wallet: memberWallet(req), who: who(req) })));
  router.get('/approval/:id', run((db, req) => approvalView(db, frame(db), { id: String(req.params.id) })));
  router.get('/:session', run((db, req) => paySessionView(db, deps.session(db), { session: session(req) })));
  router.get('/:session/frame', run((db, req) => frameOrigin(db, { session: session(req) })));
  router.post('/:session/pay', deps.limits.act, run((db, req) => payInSession(db, deps.session(db), { session: session(req), request: req.body })));
  router.post('/:session/contact', deps.limits.act, run((db, req) => sendContact(db, frame(db), { session: session(req), request: req.body })));
  router.post('/:session/code', deps.limits.act, run((db, req) => verifyCode(db, frame(db), { session: session(req), request: req.body })));
  router.get('/:session/status', run((db, req) => frameStatus(db, frame(db), { session: session(req) })));
  router.get('/:session/member', run((db, req) => memberQuote(db, frame(db), { session: session(req), token: token(req) })));
  router.post('/:session/approve', deps.limits.act, run((db, req) => approveInFrame(db, frame(db), { session: session(req), token: token(req), request: req.body })));
  router.post('/:session/approval', deps.limits.act, run((db, req) => approvalPage(db, frame(db), { session: session(req) })));
  router.post('/:session/card', deps.limits.act, run((db, req) => startCard(db, deps.session(db), { session: session(req), claims: token(req) ? claimsFrom(session(req), token(req)) : null, request: req.body })));
  router.post('/:session/join', deps.limits.act, run((db, req) => startJoin(db, { session: session(req), claims: claimsFrom(session(req), token(req)), request: req.body })));
  router.get('/:session/join', run((db, req) => joinState(db, { session: session(req), claims: claimsFrom(session(req), token(req)) })));
  return router;
}
