import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Db } from '../db/db.js';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { publicKeyPem, shopApproval } from '../services/merchant/connect/connectService.js';
import { bridgeKyb, type BridgeKyb } from '../services/merchant/kyb/kybService.js';

/**
 * For useclear.org's server, mounted on /api/public. See services/merchant/connect.
 *
 *   GET /public/shops/:id/approval    { status: pending | approved | declined }, behind the site's
 *                                     key (SHOP_SITE_API_KEY here, SHOP_API_KEY on the site): the
 *                                     site refunds deposits for declined shops. Keyed, because an
 *                                     open route would tell anyone the standing of any shop address.
 *   GET /public/shop-connect/key      the public key the site verifies shop tokens with (its
 *                                     CLEAR_API_PUBLIC_KEY). Public by nature; here for setup.
 */

export type PublicShopsDeps = { db: () => Promise<Db | null>; bridge: () => BridgeKyb; env: () => NodeJS.ProcessEnv };

const defaults: PublicShopsDeps = { db: merchantDb, bridge: bridgeKyb, env: () => process.env };

function siteKeyOk(req: Request, env: NodeJS.ProcessEnv): boolean {
  const want = env.SHOP_SITE_API_KEY ?? '';
  const header = req.headers.authorization ?? '';
  const got = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (want.length < 32 || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function publicShopsRouter(deps: PublicShopsDeps = defaults) {
  const router = forwardAsyncErrors(Router());

  router.get('/shops/:id/approval', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    if (!siteKeyOk(req, deps.env())) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const id = String(req.params.id);
    if (!/^0x[0-9a-fA-F]{40}$/.test(id)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const d = await deps.db();
    if (!d) {
      res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
      return;
    }
    const status = await shopApproval(d, deps.bridge(), id);
    if (!status) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ status });
  });

  router.get('/shop-connect/key', (_req: Request, res: Response) => {
    const pem = publicKeyPem(deps.env());
    if (!pem) {
      res.status(503).json({ error: 'not_configured', message: 'SHOP_CONNECT_PRIVATE_KEY is not set.' });
      return;
    }
    res.type('text/plain').send(pem);
  });

  return router;
}
