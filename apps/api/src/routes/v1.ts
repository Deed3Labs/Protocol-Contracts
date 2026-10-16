import { randomBytes } from 'node:crypto';
import { Router, type ErrorRequestHandler, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { apiError, IDEMPOTENCY_HEADER, resolveVersion, VERSION_HEADER, type ClearVersion, type ErrorCode } from '@clear/public-api-contracts';
import { merchantDb } from '../config/merchantDb.js';
import type { Db } from '../db/db.js';
import { limitByAddress } from '../middleware/rateLimiter.js';
import { connectorForShop } from '../services/merchant/cards/registry.js';
import { authenticateKey, originAllowed, type KeyAuth } from '../services/merchant/pay/keys.js';
import { PayError } from '../services/merchant/pay/links.js';
import { cancelPayment, createLinkV1, createModalSession, createPayment, createRefundV1, getPayment, listPayments, listPrices, V1Error, type V1Deps } from '../services/merchant/pay/v1.js';
import { createEndpointViaApi, deleteEndpoint, listEndpointsViaApi } from '../services/merchant/pay/webhooks.js';
import { staffStore } from '../services/merchant/staffStore.js';
import { defaultTaxApi } from '../services/merchant/tax/taxApi.js';

/**
 * Pay with Clear's public API (pay spec §8), mounted at `/v1`, apart from the merchant routes: its own
 * keys, versions and error shape (`{ error: { type, code, message, param? } }`).
 *
 *   POST   /v1/payments                 secret key, Idempotency-Key
 *   GET    /v1/payments                 secret key: by reference or dates, a page at a time
 *   GET    /v1/payments/:id             secret key (with its client secret)
 *   POST   /v1/payments/:id/cancel      secret key
 *   GET    /v1/prices                   either key
 *   POST   /v1/payment_links            secret key
 *   POST   /v1/refunds                  secret key, Idempotency-Key
 *   POST   /v1/webhook_endpoints        secret key (its secret shown once)
 *   GET    /v1/webhook_endpoints        secret key
 *   DELETE /v1/webhook_endpoints/:id    secret key
 *   POST   /v1/modal_sessions           publishable key, from one of the shop's allowed websites
 *
 * Every request names a version in `Clear-Version`, or runs at its key's pinned one; the answer says
 * which it ran at.
 */

declare module 'express-serve-static-core' {
  interface Request {
    v1?: { auth: KeyAuth; version: ClearVersion };
  }
}

export interface V1RouteDeps {
  db: () => Promise<Db | null>;
  v1: (db: Db) => V1Deps;
  limit: RequestHandler;
  now?: () => Date;
}

const pinCheck: V1Deps['orders']['pinCheck'] = async (merchant, pin) => {
  const staff = await staffStore.signInWithPin(merchant, pin);
  return staff ? { id: staff.id, role: staff.role as 'counter' | 'manager' | 'owner' } : null;
};

export const defaultV1Deps = (): V1RouteDeps => ({
  db: merchantDb,
  v1: (db) => ({
    orders: { taxApi: defaultTaxApi(), pinCheck },
    refunds: async (merchant) => ({ card: await connectorForShop(db, merchant), pinCheck }),
  }),
  limit: limitByAddress('v1', 60_000, 600),
});

const fail = (res: Response, code: ErrorCode, message: string, param?: string) => {
  const e = apiError(code, message, param);
  return res.status(new V1Error(code, message).status).json({ error: e });
};

/**
 * CORS for `/v1`, mounted before the API's own: a shop's website reads prices and opens the modal from
 * the browser with its publishable key. Any origin, never credentials; whether that origin may use the
 * key is the routes' check, not the browser's.
 */
export const v1Cors: RequestHandler = (req, res, next) => {
  const origin = req.header('origin');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
    res.setHeader('Access-Control-Allow-Headers', `Authorization, Content-Type, ${VERSION_HEADER}, ${IDEMPOTENCY_HEADER}`);
    res.setHeader('Access-Control-Expose-Headers', `${VERSION_HEADER}, Request-Id`);
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
};

/** A body that isn't JSON, before any route sees it. Mounted on `/v1` after the router. */
export const v1Errors: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if ((err as { type?: string }).type === 'entity.parse.failed') return fail(res, 'parameter_invalid', 'The body isn’t valid JSON');
  if (err instanceof V1Error) return res.status(err.status).json({ error: err.error });
  console.error('[v1] failed:', (err as Error)?.message);
  return fail(res, 'internal_error', 'Something went wrong at Clear. It’s safe to retry with the same Idempotency-Key.');
};

export function v1Router(deps: V1RouteDeps = defaultV1Deps()): Router {
  const router = Router();
  const now = () => deps.now?.() ?? new Date();

  router.use((_req, res, next) => {
    res.setHeader('Request-Id', `req_${randomBytes(12).toString('hex')}`);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(deps.limit);

  // Who's asking, at which version.
  router.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.header('authorization') ?? '';
      const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
      if (!token) return fail(res, 'key_missing', 'Send your key as Authorization: Bearer <key>');
      const db = await deps.db();
      if (!db) return fail(res, 'internal_error', 'Clear isn’t available right now');
      const found = await authenticateKey(db, token, now());
      if (!found.ok) return fail(res, found.code, found.code === 'key_expired' ? 'That key was rolled and has stopped working' : 'That isn’t a Clear API key');
      const version = resolveVersion(req.header(VERSION_HEADER), found.auth.pinnedVersion);
      if (!version.ok) return fail(res, 'version_unknown', `There’s no Clear-Version ${req.header(VERSION_HEADER)}`);
      res.setHeader(VERSION_HEADER, version.version);
      req.v1 = { auth: found.auth, version: version.version };
      next();
    } catch (error) {
      next(error);
    }
  });

  const secretOnly: RequestHandler = (req, res, next) =>
    req.v1!.auth.kind === 'secret' ? next() : fail(res, 'publishable_key_not_allowed', 'A publishable key can only read prices and open the modal; use the secret key on your server');
  const idempotent: RequestHandler = (req, res, next) => {
    const key = req.header(IDEMPOTENCY_HEADER);
    if (!key) return fail(res, 'idempotency_key_required', `Send an ${IDEMPOTENCY_HEADER}, so a retry never charges or refunds twice`);
    if (key.length < 8 || key.length > 200) return fail(res, 'parameter_invalid', `${IDEMPOTENCY_HEADER} is 8 to 200 characters`, IDEMPOTENCY_HEADER);
    next();
  };
  const run =
    (fn: (db: Db, req: Request) => Promise<unknown>, status = 200): RequestHandler =>
    async (req, res, next) => {
      try {
        const db = (await deps.db())!;
        res.status(status).json(await fn(db, req));
      } catch (error) {
        if (error instanceof PayError) return fail(res, 'parameter_invalid', error.message);
        next(error);
      }
    };
  const auth = (req: Request) => req.v1!.auth;
  const idem = (req: Request) => req.header(IDEMPOTENCY_HEADER)!;

  router.post('/payments', secretOnly, idempotent, run((db, req) => createPayment(db, deps.v1(db), { auth: auth(req), body: req.body, idempotencyKey: idem(req), now: now() })));
  router.get('/payments', secretOnly, run((db, req) => listPayments(db, { auth: auth(req), query: req.query })));
  router.get('/payments/:id', secretOnly, run((db, req) => getPayment(db, { auth: auth(req), id: String(req.params.id) })));
  router.post('/payments/:id/cancel', secretOnly, run((db, req) => cancelPayment(db, { auth: auth(req), id: String(req.params.id) })));
  router.get('/prices', run((db, req) => listPrices(db, { auth: auth(req) })));
  router.post('/payment_links', secretOnly, run((db, req) => createLinkV1(db, { auth: auth(req), body: req.body, now: now() })));
  router.post('/refunds', secretOnly, idempotent, run((db, req) => createRefundV1(db, deps.v1(db), { auth: auth(req), body: req.body, idempotencyKey: idem(req) })));
  router.post('/webhook_endpoints', secretOnly, run((db, req) => createEndpointViaApi(db, { merchant: auth(req).merchant, livemode: auth(req).livemode, request: req.body })));
  router.get('/webhook_endpoints', secretOnly, run(async (db, req) => ({ object: 'list', data: await listEndpointsViaApi(db, { merchant: auth(req).merchant, livemode: auth(req).livemode }), hasMore: false })));
  router.delete('/webhook_endpoints/:id', secretOnly, run((db, req) => deleteEndpoint(db, { merchant: auth(req).merchant, livemode: auth(req).livemode, id: String(req.params.id), staffId: null })));

  // The modal: a publishable key, from one of the shop's allowed websites only.
  router.post('/modal_sessions', async (req, res, next) => {
    try {
      const a = auth(req);
      if (a.kind !== 'publishable') return fail(res, 'parameter_invalid', 'A modal is opened from the web page, with the publishable key');
      const db = (await deps.db())!;
      const origin = req.header('origin');
      if (!(await originAllowed(db, { merchant: a.merchant, origin, livemode: a.livemode }))) {
        return fail(res, 'origin_not_allowed', origin ? `${origin} isn’t one of this shop’s allowed websites` : 'Open the modal from one of the shop’s allowed websites');
      }
      res.status(200).json(await createModalSession(db, { auth: a, origin: origin!, body: req.body, now: now() }));
    } catch (error) {
      next(error);
    }
  });

  router.use((_req, res) => fail(res, 'route_not_found', 'There’s no such route in the Clear API'));
  router.use(v1Errors);
  return router;
}
