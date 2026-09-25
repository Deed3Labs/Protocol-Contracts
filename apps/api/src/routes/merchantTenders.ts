import { CreateCardTender } from '@clear/merchant-contracts';
import { seesMoney } from '@clear/domain';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireMerchant } from '../middleware/merchantAuth.js';
import { adjustCardTip, cancelCardTender, createCardTender, presentCardTender, syncCardTender, TenderError, type TenderRow, toTender } from '../services/merchant/cards/cardTenders.js';
import { defaultCardConnector } from '../services/merchant/cards/stripeConnector.js';
import { terminalRefusal } from './merchantCards.js';

/**
 * Card tenders (card-processing prompt, Phases 4 and 5), mounted on /api/merchant.
 *
 *   GET  /orders/:orderId/tenders         the order's tenders
 *   POST /orders/:orderId/tenders/card    start a card payment: the reader SDK gets the client secret
 *   POST /tenders/:id/present             send it to the shop's smart reader (server-driven)
 *   POST /tenders/:id/sync                after the tap, catch the tender up with the processor
 *   POST /tenders/:id/cancel              void before capture (an authorised one needs a manager)
 *   POST /tenders/:id/tip                 change the tip before capture
 *
 * The amount, the tip and the reader come from the app; Clear's fee never does (principle 7).
 * Capture happens at Close the day (Phase 7) and in the safety job, not from a button.
 */

const STATUS: Record<TenderError['code'], number> = {
  not_found: 404,
  order_closed: 409,
  over_remaining: 422,
  reader_unknown: 422,
  key_reused: 422,
  wrong_state: 409,
  needs_manager: 403,
  tip_not_raisable: 422,
  tip_declined: 402,
  changed: 409,
  stale: 409,
  not_smart_reader: 422,
  reader_busy: 409,
  reader_offline: 503,
  reader_timeout: 504,
};

function refuse(res: Response, error: unknown): void {
  if (error instanceof TenderError) {
    res.status(STATUS[error.code]).json({ error: error.code, message: error.message });
    return;
  }
  if (terminalRefusal(res, error)) return;
  throw error;
}

async function ready(res: Response) {
  const db = await merchantDb();
  const provider = defaultCardConnector();
  if (!db || !provider) {
    res.status(503).json({ error: 'Unavailable', message: 'card processing is not set up here' });
    return null;
  }
  return { db, provider };
}

const router = forwardAsyncErrors(Router());

router.get('/orders/:orderId/tenders', requireMerchant, async (req: Request, res: Response) => {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  const { rows } = await db.query<TenderRow>('SELECT * FROM payments.tenders WHERE order_id = $1 AND merchant = $2 ORDER BY created_at, id', [
    req.params.orderId,
    req.merchant!.merchant,
  ]);
  res.json(rows.map(toTender));
});

router.post('/orders/:orderId/tenders/card', requireMerchant, async (req: Request, res: Response) => {
  const deps = await ready(res);
  if (!deps) return;
  const body = CreateCardTender.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request', message: 'an amount, a tip, a reader and a retry key' });
  try {
    res.json(
      await createCardTender(deps.db, deps.provider, {
        merchant: req.merchant!.merchant,
        orderId: String(req.params.orderId),
        staffId: req.merchant!.staff.id,
        ...body.data,
      }),
    );
  } catch (error) {
    refuse(res, error);
  }
});

router.post('/tenders/:id/present', requireMerchant, async (req: Request, res: Response) => {
  const deps = await ready(res);
  if (!deps) return;
  try {
    res.json(await presentCardTender(deps.db, deps.provider, { merchant: req.merchant!.merchant, tenderId: String(req.params.id) }));
  } catch (error) {
    refuse(res, error);
  }
});

router.post('/tenders/:id/sync', requireMerchant, async (req: Request, res: Response) => {
  const deps = await ready(res);
  if (!deps) return;
  try {
    res.json(await syncCardTender(deps.db, deps.provider, { merchant: req.merchant!.merchant, tenderId: String(req.params.id), actor: req.merchant!.staff.id }));
  } catch (error) {
    refuse(res, error);
  }
});

router.post('/tenders/:id/cancel', requireMerchant, async (req: Request, res: Response) => {
  const deps = await ready(res);
  if (!deps) return;
  try {
    res.json(
      await cancelCardTender(deps.db, deps.provider, {
        merchant: req.merchant!.merchant,
        tenderId: String(req.params.id),
        actor: req.merchant!.staff.id,
        canVoidAuthorised: seesMoney(req.merchant!.staff.role),
      }),
    );
  } catch (error) {
    refuse(res, error);
  }
});

const TipBody = z.object({ tipCents: z.number().int().min(0) });

router.post('/tenders/:id/tip', requireMerchant, async (req: Request, res: Response) => {
  const deps = await ready(res);
  if (!deps) return;
  const body = TipBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request', message: 'a tip in whole cents' });
  try {
    res.json(await adjustCardTip(deps.db, deps.provider, { merchant: req.merchant!.merchant, tenderId: String(req.params.id), tipCents: body.data.tipCents, actor: req.merchant!.staff.id }));
  } catch (error) {
    refuse(res, error);
  }
});

export default router;
