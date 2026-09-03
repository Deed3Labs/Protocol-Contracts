import type { NextFunction, Request, Response } from 'express';
import { merchantDbConfigured } from '../config/merchantDb.js';
import { type MerchantSession, sessionStore } from '../services/merchant/sessionStore.js';

/**
 * Merchant auth, separate from member auth on purpose.
 *
 * The member surface authenticates with a Privy JWT; this one with an opaque bearer token issued
 * against a staff PIN or password. They share no cookie, no storage and no middleware, which is
 * the point — the two surfaces are different products with different threat models on different
 * origins.
 *
 * `requireOwner` is not a nicety. Counter staff must never see payout figures, bank details, the
 * rate or the month's totals, and the merchant app hides those routes from its nav — but a counter
 * tablet is a shared device, and a URL somebody typed once is a URL somebody can type again. The
 * check that matters is this one, on the server.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      merchant?: MerchantSession;
    }
  }
}

function bearer(req: Request): string {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export async function requireMerchant(req: Request, res: Response, next: NextFunction) {
  if (!merchantDbConfigured()) {
    res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
    return;
  }

  const session = await sessionStore.resolve(bearer(req));
  if (!session) {
    res.status(401).json({ error: 'Unauthorized', message: 'sign in to continue' });
    return;
  }

  req.merchant = session;
  next();
}

/**
 * Full access only.
 *
 * Must run after `requireMerchant`. Answers 403 rather than 404: the route exists and the writer
 * is legitimately signed in, they simply are not allowed here, and pretending otherwise makes a
 * confusing bug report out of a clear rule.
 */
export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.merchant) {
    res.status(401).json({ error: 'Unauthorized', message: 'sign in to continue' });
    return;
  }
  if (req.merchant.staff.role !== 'owner') {
    res.status(403).json({ error: 'Forbidden', message: 'that needs full access' });
    return;
  }
  next();
}
