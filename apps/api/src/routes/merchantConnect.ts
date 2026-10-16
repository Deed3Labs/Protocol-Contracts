import { Router, type RequestHandler, type Request, type Response } from 'express';
import type { Db } from '../db/db.js';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireMerchant, requireOwner } from '../middleware/merchantAuth.js';
import { allowedReturn, ConnectError, mintToken, redirectTo, shopClaims, signingKey, validState } from '../services/merchant/connect/connectService.js';
import { bridgeKyb, type BridgeKyb } from '../services/merchant/kyb/kybService.js';
import { audit } from '../services/merchant/security/audit.js';

/**
 * Shop sign-in for useclear.org (services/merchant/connect), mounted on /api/merchant.
 *
 *   POST /connect/token   owners: { return, state } → { redirect }, the site's return route
 *                         carrying a ten-minute token that names this shop
 *
 * Owners only, after the owner's own Privy sign-in: the token lets the site take a deposit in the
 * shop's name, so it costs the same sign-in as enrolling a tablet, and a shift PIN cannot reach it.
 */

export type ConnectDeps = {
  db: () => Promise<Db | null>;
  auth: { merchant: RequestHandler; owner: RequestHandler };
  bridge: () => BridgeKyb;
  env: () => NodeJS.ProcessEnv;
};

const defaults: ConnectDeps = {
  db: merchantDb,
  auth: { merchant: requireMerchant, owner: requireOwner },
  bridge: bridgeKyb,
  env: () => process.env,
};

export function merchantConnectRouter(deps: ConnectDeps = defaults) {
  const router = forwardAsyncErrors(Router());

  router.post('/connect/token', deps.auth.merchant, deps.auth.owner, async (req: Request, res: Response) => {
    const env = deps.env();
    const key = signingKey(env);
    if (!key) {
      res.status(503).json({ error: 'not_configured', message: 'Shop sign-in for useclear.org is not switched on yet.' });
      return;
    }
    const ret = allowedReturn(String(req.body?.return ?? ''), env);
    const state = req.body?.state;
    if (!ret || !validState(state)) {
      // Logged: a return address that is not the site's is a misconfigured preview, or someone
      // fishing for a signed token.
      console.warn('[merchant/connect] refused a return address', { return: String(req.body?.return ?? '').slice(0, 200) });
      res.status(400).json({ error: 'invalid', message: 'That sign-in did not come from useclear.org.' });
      return;
    }
    const d = await deps.db();
    if (!d) {
      res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
      return;
    }
    try {
      const { merchant, staff } = req.merchant!;
      const claims = await shopClaims(d, deps.bridge(), merchant, staff.id);
      await audit(d, { merchant: claims.sub, actor: staff.id, action: 'shop.connected', ref: { type: 'site', id: ret.origin } });
      res.json({ redirect: redirectTo(ret, mintToken(claims, state, key), state) });
    } catch (error) {
      if (error instanceof ConnectError) {
        res.status(error.status).json({ error: error.code, message: error.message });
        return;
      }
      throw error;
    }
  });

  return router;
}
