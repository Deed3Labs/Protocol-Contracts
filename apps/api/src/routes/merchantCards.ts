import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireMerchant, requireOwner } from '../middleware/merchantAuth.js';
import { availabilityFor, CardsError, connectCards } from '../services/merchant/cards/cardsService.js';
import { defaultCardConnector } from '../services/merchant/cards/stripeConnector.js';

/**
 * Cards for a shop (card-processing prompt, Phase 3), mounted at /api/merchant/cards.
 *
 *   GET  /availability   any signed-in staff: can this shop take a card. Settings, Checkout and the
 *                        Home + sheet show Card locked or open from it.
 *   POST /connect        owners: the link into the processor's onboarding, or its dashboard once
 *                        connected. Onboarding returns to Settings › Payments.
 */

/** Where the merchant app lives, for the links back from onboarding. */
export function merchantAppUrl(): string {
  return (process.env.MERCHANT_APP_URL || 'https://merchant.useclear.org').trim();
}

const router = forwardAsyncErrors(Router());

router.get('/availability', requireMerchant, async (req: Request, res: Response) => {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  res.json(await availabilityFor(db, defaultCardConnector(), req.merchant!.merchant));
});

router.post('/connect', requireMerchant, requireOwner, async (req: Request, res: Response) => {
  const db = await merchantDb();
  const connector = defaultCardConnector();
  if (!db || !connector) {
    return res.status(503).json({ error: 'Unavailable', message: 'card processing is not set up here' });
  }
  try {
    res.json(
      await connectCards(db, connector, {
        merchant: req.merchant!.merchant,
        staffId: req.merchant!.staff.id,
        ownerEmail: req.merchant!.staff.email ?? null,
        appUrl: merchantAppUrl(),
      }),
    );
  } catch (error) {
    if (error instanceof CardsError && error.code === 'no_shop') {
      return res.status(409).json({ error: 'No shop', message: 'finish setting up the shop first' });
    }
    throw error;
  }
});

export default router;
