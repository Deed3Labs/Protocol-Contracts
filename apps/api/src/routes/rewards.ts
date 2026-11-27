import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Role } from '@clear/merchant-contracts';
import { merchantDb } from '../config/merchantDb.js';
import type { Db } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant } from '../middleware/merchantAuth.js';
import { limitByAddress } from '../middleware/rateLimiter.js';
import { chargeStore } from '../services/chargeStore.js';
import { notificationStore } from '../services/notificationStore.js';
import { sendNotificationService } from '../services/sendNotificationService.js';
import { OrderError, type OrderDeps } from '../services/merchant/orders/orderService.js';
import { staffStore } from '../services/merchant/staffStore.js';
import { defaultTaxApi } from '../services/merchant/tax/taxApi.js';
import { defaultClearSide, type ClearSide } from '../services/merchant/rewards/clearSide.js';
import {
  addCustomer,
  answerCounterConfirm,
  claimReward,
  counterConfirmView,
  inviteCustomer,
  orderCustomerState,
  removeCustomer,
  type RewardsNotifier,
} from '../services/merchant/rewards/counter.js';
import {
  joinShop,
  leaveShop,
  memberShopPurchases,
  myShops,
  partners,
  rewardsMe,
  shopActivity,
  shopBill,
  shopOrThrow,
  shopPaid,
  updateMembership,
  type CustomerDeps,
} from '../services/merchant/rewards/customerApp.js';
import { checkDomain, domainShop, setDomain } from '../services/merchant/rewards/domains.js';
import { vercelDomainsFromEnv, type VercelDomains } from '../services/merchant/rewards/vercel.js';
import { REWARDS_STATUS, RewardsError } from '../services/merchant/rewards/errors.js';
import { resolveMemberAuthSubject } from '../middleware/memberCapabilities.js';
import { memberStore } from '../services/memberStore.js';
import { fontFile, fontsFor, uploadFont } from '../services/merchant/rewards/fonts.js';
import { createPerson, deletePerson, requirePerson, resolvePerson, toPerson, type Caller } from '../services/merchant/rewards/people.js';
import {
  createReward,
  ensureShopApp,
  giveBackFor,
  manifestFor,
  patchShopApp,
  publicShopApp,
  removeReward,
  rewardsFor,
  rulesAt,
  toShopApp,
  updateOffer,
  updateReward,
} from '../services/merchant/rewards/shopApp.js';
import { mintIdentityId, mintSession, readSession, type SessionClaims } from '../services/merchant/rewards/tokens.js';

/**
 * Rewards (docs/rewards-reference, section 11).
 *
 *   /api/s/:slug                         public: the shop's app config, its manifest, its fonts
 *   POST /api/s/:slug/session            a token that sees this shop (from a Privy session or the hub's token)
 *   /api/s/:slug/me|join|membership|rewards/:id/claim|activity|bill/:point|paid/:order   with that token
 *   POST /api/rewards/session            the hub's token: lists shops, mints shop tokens
 *   /api/rewards/me, /me/shops, /me/code with a rewards token
 *   /api/rewards/confirm/:token          a number typed at the counter, confirmed on the phone
 *   /api/partners?near=lat,lng           Clear shops with an app, nearest first
 *   /api/merchant/shop-app…              Settings › Shop app (owners and managers edit; the counter views)
 *   /api/merchant/orders/:id/customer…   adding a member at the cart
 *
 * A shop's token is refused by every route that isn't its shop's (403 `scope`), and by every member
 * route, because `requireAuth` only takes Privy tokens.
 */

export interface RewardsDeps {
  db: () => Promise<Db | null>;
  clear: ClearSide;
  notify: RewardsNotifier;
  orders: () => OrderDeps;
  chargePaidNow: (code: string) => Promise<boolean | null>;
  /** `https://rewards.useclear.org` */
  rewardsUrl: string;
  /** The Privy check (`requireAuth`); tests stand one in. */
  privy: RequestHandler;
  limits: { read: RequestHandler; act: RequestHandler };
  /** Where the API serves its own files from, for font URLs. */
  apiUrl: string;
  /** The member's auth subject once onboarding is submitted, or null (`GET /api/rewards/purchases`). */
  onboarded: (req: Request) => Promise<string | null>;
  /** The rewards Vercel project's domains (Phase 7), or null without its token and project. */
  vercel: VercelDomains | null;
}

const pinCheck: OrderDeps['pinCheck'] = async (merchant, pin) => {
  const staff = await staffStore.signInWithPin(merchant, pin);
  return staff ? { id: staff.id, role: staff.role as Role } : null;
};

export const defaultRewardsDeps = (): RewardsDeps => ({
  db: merchantDb,
  clear: defaultClearSide(),
  notify: {
    text: async (to, message) => Boolean(await sendNotificationService.sendShopText({ to, message })),
    app: async (wallet, n) => {
      await notificationStore.emit({ wallet, kind: 'request', title: n.title, body: n.body, data: { url: n.url }, dedupeKey: n.dedupeKey });
    },
  },
  orders: () => ({ taxApi: defaultTaxApi(), pinCheck }),
  chargePaidNow: async (code) => {
    const c = await chargeStore.get(code);
    return c ? Boolean(c.paidNow) : null;
  },
  rewardsUrl: (process.env.REWARDS_APP_URL || 'https://rewards.useclear.org').replace(/\/+$/, ''),
  privy: requireAuth,
  limits: { read: limitByAddress('rewards', 60_000, 240), act: limitByAddress('rewards-act', 60_000, 30) },
  apiUrl: (process.env.API_PUBLIC_URL || '').replace(/\/+$/, ''),
  vercel: vercelDomainsFromEnv(),
  onboarded: async (req) => {
    if (!memberStore.isConfigured()) return null;
    await memberStore.ensureReady();
    const subject = await resolveMemberAuthSubject(req);
    const member = await memberStore.getMemberByAuthSubject(subject);
    return member && member.status !== 'ONBOARDING' ? subject : null;
  },
});

declare global {
  namespace Express {
    interface Request {
      rewards?: SessionClaims;
    }
  }
}

function bearer(req: Request): string {
  const h = req.headers.authorization ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

/** A rewards token, of any scope. */
export function readRewardsToken(req: Request): SessionClaims | null {
  const t = bearer(req);
  return t.startsWith('rws.') ? readSession(t) : null;
}

const requireRewards: RequestHandler = (req, res, next) => {
  const claims = readRewardsToken(req);
  if (!claims) return res.status(401).json({ error: 'unauthorized', message: 'Sign in again', code: 'REWARDS_TOKEN_INVALID' });
  req.rewards = claims;
  next();
};

/** This shop's token only: another shop's, or the hub's, is refused. */
const requireShopToken: RequestHandler = (req, res, next) => {
  const claims = readRewardsToken(req);
  if (!claims) return res.status(401).json({ error: 'unauthorized', message: 'Sign in again', code: 'REWARDS_TOKEN_INVALID' });
  const slug = String(req.params.slug ?? '').toLowerCase();
  if (!('shop' in claims.scope) || claims.scope.shop !== slug) return res.status(403).json({ error: 'scope', message: 'That isn’t this shop’s' });
  req.rewards = claims;
  next();
};

const callerOf = (c: SessionClaims): Caller => ({ did: c.did, wallet: c.wallet, phone: c.phone ?? null, email: c.email ?? null });

function runWith(deps: RewardsDeps) {
  return (fn: (db: Db, req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    const db = await deps.db();
    if (!db) return res.status(503).json({ error: 'unavailable', message: 'Rewards isn’t available right now' });
    try {
      const out = await fn(db, req, res);
      if (res.headersSent) return;
      if (out === undefined) return res.status(204).end();
      return res.json(out);
    } catch (error) {
      if (error instanceof RewardsError) return res.status(REWARDS_STATUS[error.code]).json({ error: error.code, message: error.message });
      if (error instanceof OrderError) return res.status(error.code === 'not_found' ? 404 : error.code === 'locked' || error.code === 'one_discount' ? 409 : 422).json({ error: error.code, message: error.message });
      throw error;
    }
  };
}

const customerDeps = (deps: RewardsDeps): CustomerDeps => ({ clear: deps.clear, orders: deps.orders(), chargePaidNow: deps.chargePaidNow });

/** `/api/s` */
export function shopRouter(deps: RewardsDeps = defaultRewardsDeps()): Router {
  const router = forwardAsyncErrors(Router());
  const run = runWith(deps);
  const slug = (req: Request) => String(req.params.slug).toLowerCase();
  router.use(deps.limits.read);

  router.get('/:slug', run(async (db, req, res) => {
    const app = await publicShopApp(db, slug(req));
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
    res.setHeader('ETag', `"${app.slug}-${app.configVersion}"`);
    return app;
  }));
  router.get('/:slug/manifest.webmanifest', run(async (db, req, res) => {
    const m = await manifestFor(db, slug(req));
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(JSON.stringify(m));
  }));
  router.get('/:slug/fonts/:file', run(async (db, req, res) => {
    const id = String(req.params.file).replace(/\.woff2$/, '');
    const file = await fontFile(db, slug(req), id);
    if (!file) throw new RewardsError('No such font', 'not_found');
    res.setHeader('Content-Type', 'font/woff2');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(file);
  }));

  // A token for this shop: from the Privy session, or from the hub's token.
  const signedIn: RequestHandler = (req, res, next) => {
    const hub = readRewardsToken(req);
    if (hub && 'hub' in hub.scope) {
      req.rewards = hub;
      return next();
    }
    return deps.privy(req, res, next);
  };
  router.post('/:slug/session', deps.limits.act, signedIn, run(async (db, req) => {
    const shop = await shopOrThrow(db, slug(req));
    const from: Omit<SessionClaims, 'exp' | 'scope'> = req.rewards
      ? { did: req.rewards.did, wallet: req.rewards.wallet, phone: req.rewards.phone, email: req.rewards.email }
      : { did: req.auth!.profileUuid!, wallet: req.auth!.smartWallet ?? req.auth!.walletAddress, phone: req.auth!.phone ?? null, email: req.auth!.email ?? null };
    const s = mintSession({ ...from, scope: { shop: toShopApp(shop).slug } });
    return { token: s.token, expiresAt: s.expiresAt, scope: { shop: toShopApp(shop).slug } };
  }));

  router.get('/:slug/me', requireShopToken, run(async (db, req) => {
    const person = await requirePerson(db, deps.clear, callerOf(req.rewards!));
    const me = await rewardsMe(db, customerDeps(deps), { slug: slug(req), person, phone: req.rewards!.phone });
    return { ...me, person: toPerson(person, callerOf(req.rewards!)) };
  }));
  router.post('/:slug/join', deps.limits.act, requireShopToken, run(async (db, req) => {
    const person = await requirePerson(db, deps.clear, callerOf(req.rewards!));
    return db.transaction((tx) => joinShop(tx, { slug: slug(req), person, body: req.body }));
  }));
  router.patch('/:slug/membership', requireShopToken, run(async (db, req) => {
    const person = await requirePerson(db, deps.clear, callerOf(req.rewards!));
    return updateMembership(db, { slug: slug(req), person, body: req.body });
  }));
  router.delete('/:slug/membership', requireShopToken, run(async (db, req) => {
    const person = await requirePerson(db, deps.clear, callerOf(req.rewards!));
    await db.transaction((tx) => leaveShop(tx, { slug: slug(req), person }));
    return undefined;
  }));
  router.post('/:slug/rewards/:id/claim', deps.limits.act, requireShopToken, run(async (db, req) => {
    const person = await requirePerson(db, deps.clear, callerOf(req.rewards!));
    const shop = await shopOrThrow(db, slug(req));
    return claimReward(db, { merchant: shop.merchant, personId: person.id, rewardId: String(req.params.id), host: `${deps.rewardsUrl}` });
  }));
  router.get('/:slug/activity', requireShopToken, run(async (db, req) => {
    const person = await requirePerson(db, deps.clear, callerOf(req.rewards!));
    return shopActivity(db, { slug: slug(req), person });
  }));
  router.get('/:slug/bill/:point', requireShopToken, run(async (db, req) => {
    const person = await requirePerson(db, deps.clear, callerOf(req.rewards!));
    return shopBill(db, customerDeps(deps), { slug: slug(req), pointCode: String(req.params.point), person });
  }));
  router.get('/:slug/paid/:order', requireShopToken, run(async (db, req) => {
    const person = await requirePerson(db, deps.clear, callerOf(req.rewards!));
    return shopPaid(db, customerDeps(deps), { slug: slug(req), orderId: String(req.params.order), person });
  }));
  return router;
}

/** `/api/rewards` */
export function rewardsRouter(deps: RewardsDeps = defaultRewardsDeps()): Router {
  const router = forwardAsyncErrors(Router());
  const run = runWith(deps);
  router.use(deps.limits.read);

  router.post('/session', deps.limits.act, deps.privy, run(async (_db, req) => {
    const a = req.auth!;
    const s = mintSession({ did: a.profileUuid!, wallet: a.smartWallet ?? a.walletAddress, phone: a.phone ?? null, email: a.email ?? null, scope: { hub: true } });
    return { token: s.token, expiresAt: s.expiresAt, scope: { hub: true } };
  }));

  router.get('/me', requireRewards, run(async (db, req) => {
    const p = await resolvePerson(db, deps.clear, callerOf(req.rewards!));
    return p ? toPerson(p, callerOf(req.rewards!)) : null;
  }));
  router.post('/me', deps.limits.act, requireRewards, run(async (db, req) => toPerson(await createPerson(db, deps.clear, callerOf(req.rewards!), req.body), callerOf(req.rewards!))));
  router.delete('/me', requireRewards, run(async (db, req) => {
    const p = await resolvePerson(db, deps.clear, callerOf(req.rewards!));
    if (p) await db.transaction((tx) => deletePerson(tx, p.id));
    return undefined;
  }));
  router.get('/me/shops', requireRewards, run(async (db, req) => {
    const p = await resolvePerson(db, deps.clear, callerOf(req.rewards!));
    return p ? myShops(db, { person: p }) : { shops: [] };
  }));
  // A shop's own domain, as the app on it asks which shop it is (Phase 7). Public: it names a shop
  // whose link is public anyway.
  router.get('/domain/:host', run(async (db, req) => domainShop(db, String(req.params.host))));
  // Activity's card and cash purchases at shops, once they've set up Clear (Phase 6).
  router.get('/purchases', deps.privy, run(async (db, req) => {
    const subject = await deps.onboarded(req);
    if (!subject) throw new RewardsError('Complete account onboarding before using this feature', 'forbidden');
    return memberShopPurchases(db, { authSubject: subject, did: req.auth?.profileUuid ?? null });
  }));
  router.post('/me/code', requireRewards, run(async (_db, req) => {
    const { id, expiresAt } = mintIdentityId(req.rewards!.wallet);
    return { payload: `${deps.rewardsUrl}/send?to=${req.rewards!.wallet}&id=${id}`, expiresAt };
  }));

  router.get('/confirm/:token', run(async (db, req) => counterConfirmView(db, String(req.params.token))));
  router.post('/confirm/:token', deps.limits.act, run(async (db, req) => {
    const claims = readRewardsToken(req);
    const person = claims ? await resolvePerson(db, deps.clear, callerOf(claims)) : null;
    const answer = req.body?.answer === 'decline' ? 'decline' : 'confirm';
    await db.transaction((tx) => answerCounterConfirm(tx, { token: String(req.params.token), answer, person }));
    return undefined;
  }));
  return router;
}

/** `/api/partners` */
export function partnersRouter(deps: RewardsDeps = defaultRewardsDeps()): Router {
  const router = forwardAsyncErrors(Router());
  const run = runWith(deps);
  router.use(deps.limits.read);
  router.get('/', run(async (db, req) => {
    const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(String(req.query.near ?? ''));
    const near = m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
    const claims = readRewardsToken(req);
    const person = claims ? await resolvePerson(db, deps.clear, callerOf(claims)) : null;
    return partners(db, { near, personId: person?.id ?? null });
  }));
  return router;
}

/** Under `/api/merchant`. */
export function merchantRewardsRouter(deps: RewardsDeps = defaultRewardsDeps()): Router {
  const router = forwardAsyncErrors(Router());
  const run = runWith(deps);
  const fontUrl = (slug: string) => (id: string) => `${deps.apiUrl}/api/s/${slug}/fonts/${id}.woff2`;
  const who = (req: Request) => req.merchant!;
  const counterDeps = () => ({ clear: deps.clear, notify: deps.notify, rewardsUrl: deps.rewardsUrl });

  async function settings(db: Db, merchant: string, staffId: string, role: Role) {
    const row = await ensureShopApp(db, merchant, staffId);
    const app = toShopApp(row);
    const { rows: counts } = await db.query<{ joined: string | number; week: string | number; clear: string | number }>(
      `SELECT count(*) AS joined, count(*) FILTER (WHERE m.joined_at > now() - interval '7 days') AS week, count(*) FILTER (WHERE p.member_subject IS NOT NULL) AS clear
         FROM rewards.loyalty_memberships m JOIN rewards.people p ON p.id = m.person_id WHERE m.merchant = $1`,
      [merchant],
    );
    const { rows: domain } = await db.query<{ domain: string; status: 'pending' | 'verified' | 'failed'; record: object | string; checked_at: Date | null; verified_at: Date | null }>(
      'SELECT * FROM rewards.shop_domains WHERE merchant = $1 AND removed_at IS NULL',
      [merchant],
    );
    const { rows: builds } = await db.query<{ id: string; platform: 'ios' | 'android'; bundle_id: string; version: string; config_version: number; review: 'not_submitted'; note: string | null; updated_at: Date }>(
      'SELECT * FROM rewards.store_builds WHERE merchant = $1 ORDER BY updated_at DESC',
      [merchant],
    );
    const d = domain[0];
    return {
      app,
      rules: await rulesAt(db, merchant),
      rewards: await rewardsFor(db, merchant),
      fonts: await fontsFor(db, merchant, fontUrl(app.slug)),
      domain: d
        ? { domain: d.domain, shopSlug: app.slug, status: d.status, record: typeof d.record === 'string' ? JSON.parse(d.record) : d.record, checkedAt: d.checked_at ? new Date(d.checked_at).toISOString() : null, verifiedAt: d.verified_at ? new Date(d.verified_at).toISOString() : null }
        : null,
      storeBuilds: builds.map((b) => ({ id: b.id, platform: b.platform, bundleId: b.bundle_id, version: b.version, configVersion: b.config_version, review: b.review, note: b.note, updatedAt: new Date(b.updated_at).toISOString() })),
      members: { joined: Number(counts[0]?.joined ?? 0), thisWeek: Number(counts[0]?.week ?? 0), withClear: Number(counts[0]?.clear ?? 0) },
      link: `useclear.org/s/${app.slug}`,
      giveBack: await giveBackFor(db, merchant),
      canEdit: role === 'owner' || role === 'manager',
    };
  }

  router.get('/shop-app', requireMerchant, run(async (db, req) => settings(db, who(req).merchant, who(req).staff.id, who(req).staff.role as Role)));
  router.patch('/shop-app', requireMerchant, requireManager, run(async (db, req) => {
    await db.transaction((tx) => patchShopApp(tx, who(req).merchant, who(req).staff.id, req.body));
    return settings(db, who(req).merchant, who(req).staff.id, who(req).staff.role as Role);
  }));
  router.get('/shop-app/give-back', requireMerchant, run(async (db, req) => giveBackFor(db, who(req).merchant)));
  router.post('/shop-app/give-back', requireMerchant, run(async (db, req) => giveBackFor(db, who(req).merchant, req.body?.rules ?? req.body)));
  router.post('/shop-app/rewards', requireMerchant, requireManager, run(async (db, req) => {
    await ensureShopApp(db, who(req).merchant, who(req).staff.id);
    return createReward(db, who(req).merchant, req.body);
  }));
  router.patch('/shop-app/rewards/:id', requireMerchant, requireManager, run(async (db, req) => db.transaction((tx) => updateReward(tx, who(req).merchant, String(req.params.id), req.body, who(req).staff.id))));
  router.delete('/shop-app/rewards/:id', requireMerchant, requireManager, run(async (db, req) => {
    await removeReward(db, who(req).merchant, String(req.params.id));
    return undefined;
  }));
  // The file is the body (1 MB at most); its fields ride in the query.
  router.post('/shop-app/fonts', requireMerchant, requireManager, express.raw({ type: () => true, limit: '1mb' }), run(async (db, req) => {
    const row = await ensureShopApp(db, who(req).merchant, who(req).staff.id);
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return uploadFont(db, {
      merchant: who(req).merchant,
      staffId: who(req).staff.id,
      fileName: String(req.query.fileName ?? 'font'),
      bytes,
      fields: { name: req.query.name, usedFor: req.query.usedFor, licenceDeclared: req.query.licenceDeclared === 'true' },
      urlFor: fontUrl(toShopApp(row).slug),
    });
  }));
  router.post('/shop-app/domain', requireMerchant, requireManager, run(async (db, req) => setDomain(db, { merchant: who(req).merchant, body: req.body, vercel: deps.vercel })));
  router.post('/shop-app/domain/check', requireMerchant, requireManager, run(async (db, req) => checkDomain(db, who(req).merchant, deps.vercel)));
  router.patch('/shop-app/offers/:codeId', requireMerchant, requireManager, run(async (db, req) =>
    db.transaction((tx) => updateOffer(tx, who(req).merchant, who(req).staff.id, String(req.params.codeId), req.body)),
  ));

  router.get('/orders/:id/customer', requireMerchant, run(async (db, req) => orderCustomerState(db, counterDeps(), { merchant: who(req).merchant, orderId: String(req.params.id) })));
  router.post('/orders/:id/customer', requireMerchant, run(async (db, req) =>
    db.transaction((tx) => addCustomer(tx, counterDeps(), { merchant: who(req).merchant, orderId: String(req.params.id), staffId: who(req).staff.id, body: req.body })),
  ));
  router.delete('/orders/:id/customer', requireMerchant, run(async (db, req) => {
    await db.transaction((tx) => removeCustomer(tx, { merchant: who(req).merchant, orderId: String(req.params.id), staffId: who(req).staff.id }));
    return undefined;
  }));
  router.post('/orders/:id/customer/invite', requireMerchant, run(async (db, req) => inviteCustomer(db, counterDeps(), { merchant: who(req).merchant, orderId: String(req.params.id) })));
  return router;
}
