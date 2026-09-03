import type { NextFunction, Request, Response } from 'express';
import { merchantDbConfigured } from '../config/merchantDb.js';
import { type DeviceRow, deviceStore } from '../services/merchant/deviceStore.js';
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
      device?: DeviceRow;
    }
  }
}

/**
 * The enrolled tablet, from its own header.
 *
 * A separate header from `Authorization` because these are separate facts with separate lifetimes:
 * the device token says which shop this tablet is and lasts until an owner removes it; the bearer
 * token says who is on shift and expires overnight. Folding them into one header would mean a
 * tablet forgot which shop it was every time a shift ended.
 */
function deviceToken(req: Request): string {
  return String(req.headers['x-clear-device'] ?? '').trim();
}

/**
 * This tablet is enrolled — reference section 19.
 *
 * The device is the real boundary. A PIN is attribution and a shift session says who is at the
 * counter, but neither is a thing an owner can take away from across town; this is. Revocation
 * writes one row and takes effect on the next request, which is what makes the enrollment screen's
 * promise — remove it any time, from any device — true rather than aspirational.
 *
 * It also carries the merchant, so routes reached before anyone signs in no longer have to take a
 * shop address from the request body and hope.
 */
export async function requireDevice(req: Request, res: Response, next: NextFunction) {
  if (!merchantDbConfigured()) {
    res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
    return;
  }

  const device = await deviceStore.resolve(deviceToken(req));
  if (!device) {
    // 409 rather than 401: nobody's credentials are wrong, this tablet is simply not set up — and
    // the app needs to tell those apart to know whether to show the PIN pad or the enrollment
    // screen. A revoked device lands here too, which is the correct outcome for a lost tablet.
    res.status(409).json({ error: 'Not enrolled', message: 'this device is not set up' });
    return;
  }

  req.device = device;
  next();
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
