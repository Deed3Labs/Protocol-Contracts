import type { NextFunction, Request, Response } from 'express';
import { stepUpStore } from '../services/stepUp/stepUpStore.js';
import { stepUpTokenValid } from '../services/stepUp/stepUpToken.js';
import { sessionLock } from '../services/session/sessionLock.js';

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

/*
 * Re-authentication, never skipped: for what must not be shown on a session alone (Spendable's full
 * account number, which pays out of the member's bank account if it leaks).
 *
 * `requireStepUp` lets a member with no Face ID through, on purpose: for a card freeze or a bill,
 * locking them out of their own card is the worse failure. Showing a full account number is not
 * like that, so here a member always proves it is them, with what the server can check:
 *
 *   - Face ID for payments (routes/stepUp): a fresh X-Step-Up token, exactly as requireStepUp.
 *   - Without it, a sign-in made in the last ten minutes (sessionLock.freshSignIn) -- the same
 *     fallback that registers or resets Face ID. It takes the code Privy sends to the member's own
 *     email or phone, which a stolen session cannot produce. Refused with REAUTH_REQUIRED, and the
 *     app offers to send that code.
 *   - Neither (no Face ID, and no email or phone a code could go to): refused with
 *     STEP_UP_UNAVAILABLE, saying how to set Face ID up. Nothing home-made stands in for it.
 *
 * When the server cannot check any of this (its database is out), it refuses: an outage must not be
 * the way round re-authentication.
 */

export const REAUTH_REQUIRED = 'REAUTH_REQUIRED';
export const STEP_UP_UNAVAILABLE = 'STEP_UP_UNAVAILABLE';

export const REAUTH_MESSAGE =
  "Confirm it's you to see your full account number: sign in again with the code we send you. It works for ten minutes after you sign in.";
export const NO_REAUTH_METHOD_MESSAGE =
  'To see your full account number, turn on Face ID in Settings › Security first. Clear needs a way to confirm it’s you, and your account has none yet.';

async function reauthCheck(req: Request, res: Response): Promise<boolean> {
  const userId = req.auth?.profileUuid;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (!stepUpStore.available() || !sessionLock.available()) {
    res.status(503).json({ error: "We can't confirm it's you just now, so the full number stays hidden. Please try again." });
    return false;
  }
  let enrolled: boolean;
  try {
    enrolled = await stepUpStore.enrolled(userId);
  } catch (error) {
    console.error('[step-up] could not read credentials', (error as Error)?.message);
    res.status(503).json({ error: 'We could not check Face ID just now. Please try again.' });
    return false;
  }
  if (enrolled) {
    if (stepUpTokenValid(req.header(STEP_UP_HEADER) || undefined, userId)) return true;
    return stepUpRequired(req, res);
  }

  // No Face ID: a fresh sign-in, which takes a code to the member's own email or phone.
  const sessionId = req.auth?.sessionId;
  const codeGoesTo = Boolean(req.auth?.email || req.auth?.phone);
  if (!sessionId || !codeGoesTo) {
    res.status(403).json({ error: NO_REAUTH_METHOD_MESSAGE, code: STEP_UP_UNAVAILABLE });
    return false;
  }
  let fresh: boolean;
  try {
    fresh = await sessionLock.freshSignIn(sessionId);
  } catch (error) {
    console.error('[step-up] could not read the session', (error as Error)?.message);
    res.status(503).json({ error: "We can't confirm it's you just now, so the full number stays hidden. Please try again." });
    return false;
  }
  if (fresh) return true;
  res.status(403).json({ error: REAUTH_MESSAGE, code: REAUTH_REQUIRED });
  return false;
}

/** Face ID, or else a sign-in made minutes ago; never nothing. See above. */
export async function requireReauth(req: Request, res: Response, next: NextFunction) {
  if (await reauthCheck(req, res)) next();
}
