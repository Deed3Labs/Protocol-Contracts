import type { NextFunction, Request, Response } from 'express';
import { stepUpStore } from '../services/stepUp/stepUpStore.js';
import { stepUpTokenValid } from '../services/stepUp/stepUpToken.js';

/*
 * Face ID, checked by the server, in front of the requests that act without a wallet signature:
 * showing card numbers or the PIN, unfreezing or re-limiting a card, a dispute, a bill, a withdrawal,
 * autopay. (On-chain money is already behind the wallet's own MFA.)
 *
 * A member with a server-held credential (routes/stepUp) must send a fresh X-Step-Up token, which only
 * a Face ID signature the server verified hands out. Editing the app's clock or its code does not
 * produce one.
 *
 * A member with none passes, as in the app: their protection is the code that signed them in, and
 * asking for something they cannot give would lock them out of their own card. Registering Face ID
 * is what turns this on, and once on, adding another device takes a Face ID check from one already
 * registered.
 */

export const STEP_UP_HEADER = 'x-step-up';

export function stepUpRequired(req: Request, res: Response): boolean {
  res.status(403).json({
    error: 'Confirm with Face ID to continue.',
    code: 'STEP_UP_REQUIRED',
  });
  return false;
}

async function check(req: Request, res: Response): Promise<boolean> {
  const userId = req.auth?.profileUuid;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (!stepUpStore.available()) return true;
  let enrolled: boolean;
  try {
    enrolled = await stepUpStore.enrolled(userId);
  } catch (error) {
    // Closed, not open: an outage must not be the way round Face ID.
    console.error('[step-up] could not read credentials', (error as Error)?.message);
    res.status(503).json({ error: 'We could not check Face ID just now. Please try again.' });
    return false;
  }
  if (!enrolled) return true;
  if (stepUpTokenValid(req.header(STEP_UP_HEADER) || undefined, userId)) return true;
  return stepUpRequired(req, res);
}

export async function requireStepUp(req: Request, res: Response, next: NextFunction) {
  if (await check(req, res)) next();
}

/** The same, only when `when` says this request needs it (unfreezing, not freezing). */
export function requireStepUpWhen(when: (req: Request) => boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!when(req)) return next();
    if (await check(req, res)) next();
  };
}
