import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant, requireOwner } from '../middleware/merchantAuth.js';
import { RecordReader, RegisterSmartReader } from '@clear/merchant-contracts';
import { connectionToken, listReaders, recordReader, registerSmartReader, TerminalError } from '../services/merchant/cards/terminal.js';
import { availabilityFor, CardsError, connectCards } from '../services/merchant/cards/cardsService.js';
import { defaultCardConnector } from '../services/merchant/cards/stripeConnector.js';

/**
 * Cards for a shop (card-processing prompt, Phase 3), mounted at /api/merchant/cards.
 *
 *   GET  /availability   any signed-in staff: can this shop take a card. Settings, Checkout and the
 *                        Home + sheet show Card locked or open from it.
 *   POST /connect        owners: the link into the processor's onboarding, or its dashboard once
 *                        connected. Onboarding returns to Settings › Payments.
 *   POST /connection-token   the reader SDKs' token, on the shop's account and location (Phase 4)
 *   GET  /readers            the shop's readers
 *   POST /readers/smart      managers: register a smart reader by the code on its screen
 *   POST /readers            record an M2 or Tap to Pay reader the installed app connected
 */

/** What a terminal refusal looks like to the app. */
export function terminalRefusal(res: Response, error: unknown): boolean {
  if (!(error instanceof TerminalError)) return false;
  const status = error.code === 'cards_unavailable' ? 409 : 422;
  res.status(status).json({ error: error.code, message: error.message });
  return true;
}

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

router.post('/connection-token', requireMerchant, async (req: Request, res: Response) => {
  const db = await merchantDb();
  const connector = defaultCardConnector();
  if (!db || !connector) return res.status(503).json({ error: 'Unavailable', message: 'card processing is not set up here' });
  try {
    res.json(await connectionToken(db, connector, req.merchant!.merchant));
  } catch (error) {
    if (!terminalRefusal(res, error)) throw error;
  }
});

router.get('/readers', requireMerchant, async (req: Request, res: Response) => {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  res.json(await listReaders(db, req.merchant!.merchant));
});

router.post('/readers/smart', requireMerchant, requireManager, async (req: Request, res: Response) => {
  const db = await merchantDb();
  const connector = defaultCardConnector();
  if (!db || !connector) return res.status(503).json({ error: 'Unavailable', message: 'card processing is not set up here' });
  const body = RegisterSmartReader.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request', message: 'a registration code and a label' });
  try {
    res.json(await registerSmartReader(db, connector, { merchant: req.merchant!.merchant, ...body.data }));
  } catch (error) {
    if (!terminalRefusal(res, error)) throw error;
  }
});

router.post('/readers', requireMerchant, async (req: Request, res: Response) => {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  const body = RecordReader.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request', message: 'a reader type, id and label' });
  try {
    res.json(await recordReader(db, { merchant: req.merchant!.merchant, ...body.data, deviceId: null }));
  } catch (error) {
    if (!terminalRefusal(res, error)) throw error;
  }
});

export default router;
