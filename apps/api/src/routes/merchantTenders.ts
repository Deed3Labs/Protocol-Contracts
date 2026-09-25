import { CreateCardTender } from '@clear/merchant-contracts';
import { seesMoney } from '@clear/domain';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireMerchant } from '../middleware/merchantAuth.js';
import { adjustCardTip, cancelCardTender, createCardTender, presentCardTender, syncCardTender, TenderError, type TenderRow, toTender } from '../services/merchant/cards/cardTenders.js';
import { connectorForShop } from '../services/merchant/cards/registry.js';
import { currentDrawer, DrawerError, openDrawer } from '../services/merchant/drawer/drawerService.js';
import { clearChargesFor } from '../services/merchant/orders/clearCharges.js';
import { businessDate } from '../services/merchant/orders/orderService.js';
import { cancelClearTender, createCashTender, createClearTender, PaymentError, syncClearTender, voidOrder } from '../services/merchant/orders/payments.js';
import { staffStore } from '../services/merchant/staffStore.js';
import type { Role } from '@clear/merchant-contracts';
import { terminalRefusal } from './merchantCards.js';

/**
 * Card tenders (card-processing prompt, Phases 4 and 5), mounted on /api/merchant.
 *
 *   GET  /orders/:orderId/tenders         the order's tenders
 *   POST /orders/:orderId/tenders/card    start a card payment: the reader SDK gets the client secret
 *   POST /orders/:orderId/tenders/cash    cash handed over: change worked out, into the open drawer
 *   POST /orders/:orderId/tenders/clear   a Clear charge the member approves on their phone
 *   POST /orders/:orderId/void            same day, before capture, with a manager's or owner's PIN
 *   GET  /drawer   POST /drawer           the open drawer, and opening it with the starting cash
 *   POST /tenders/:id/present             send it to the shop's smart reader (server-driven)
 *   POST /tenders/:id/sync                catch a card or Clear tender up with the processor or charge
 *   POST /tenders/:id/cancel              void a card before capture (an authorised one needs a
 *                                         manager), or withdraw an unanswered Clear charge
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
  method_off: 409,
};

const PAYMENT_STATUS: Record<PaymentError['code'], number> = {
  not_found: 404,
  order_closed: 409,
  over_remaining: 422,
  method_off: 409,
  split_off: 409,
  short: 422,
  invalid: 400,
  key_reused: 422,
  clear_refused: 422,
  not_voidable: 409,
  not_same_day: 409,
  approver_invalid: 403,
  drawer_closed: 409,
};

function refuse(res: Response, error: unknown): void {
  if (error instanceof PaymentError) {
    res.status(PAYMENT_STATUS[error.code]).json({ error: error.code, message: error.message });
    return;
  }
  if (error instanceof DrawerError) {
    res.status(error.code === 'invalid' ? 422 : 409).json({ error: error.code, message: error.message });
    return;
  }
  if (error instanceof TenderError) {
    res.status(STATUS[error.code]).json({ error: error.code, message: error.message });
    return;
  }
  if (terminalRefusal(res, error)) return;
  throw error;
}

/** The database and the connector this shop takes cards through, or a 503 already sent. */
async function ready(res: Response, merchant: string) {
  const db = await merchantDb();
  const provider = db && (await connectorForShop(db, merchant));
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
  const deps = await ready(res, req.merchant!.merchant);
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
  const deps = await ready(res, req.merchant!.merchant);
  if (!deps) return;
  try {
    res.json(await presentCardTender(deps.db, deps.provider, { merchant: req.merchant!.merchant, tenderId: String(req.params.id) }));
  } catch (error) {
    refuse(res, error);
  }
});

async function methodOf(merchant: string, tenderId: string): Promise<{ method: 'card' | 'cash' | 'clear' } | null> {
  const db = await merchantDb();
  if (!db) return null;
  const { rows } = await db.query<{ method: 'card' | 'cash' | 'clear' }>('SELECT method FROM payments.tenders WHERE id = $1 AND merchant = $2', [tenderId, merchant]);
  return rows[0] ?? null;
}

router.post('/tenders/:id/sync', requireMerchant, async (req: Request, res: Response) => {
  const merchant = req.merchant!.merchant;
  const tenderId = String(req.params.id);
  const found = await methodOf(merchant, tenderId);
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No such payment' });
  try {
    if (found.method === 'clear') {
      const db = (await merchantDb())!;
      return res.json(await syncClearTender(db, clearChargesFor(db), { merchant, tenderId, actor: req.merchant!.staff.id }));
    }
    const deps = await ready(res, req.merchant!.merchant);
    if (!deps) return;
    if (found.method === 'cash') {
      const { rows } = await deps.db.query<TenderRow>('SELECT * FROM payments.tenders WHERE id = $1', [tenderId]);
      return res.json(toTender(rows[0]!));
    }
    res.json(await syncCardTender(deps.db, deps.provider, { merchant, tenderId, actor: req.merchant!.staff.id }));
  } catch (error) {
    refuse(res, error);
  }
});

router.post('/tenders/:id/cancel', requireMerchant, async (req: Request, res: Response) => {
  const merchant = req.merchant!.merchant;
  const tenderId = String(req.params.id);
  const found = await methodOf(merchant, tenderId);
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No such payment' });
  try {
    if (found.method === 'cash') return res.status(409).json({ error: 'not_voidable', message: 'Cash handed over is refunded, or the order voided' });
    if (found.method === 'clear') {
      const db = (await merchantDb())!;
      return res.json(await cancelClearTender(db, clearChargesFor(db), { merchant, tenderId, actor: req.merchant!.staff.id }));
    }
    const deps = await ready(res, req.merchant!.merchant);
    if (!deps) return;
    res.json(
      await cancelCardTender(deps.db, deps.provider, {
        merchant,
        tenderId,
        actor: req.merchant!.staff.id,
        canVoidAuthorised: seesMoney(req.merchant!.staff.role),
      }),
    );
  } catch (error) {
    refuse(res, error);
  }
});

router.post('/orders/:orderId/tenders/cash', requireMerchant, async (req: Request, res: Response) => {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  try {
    res.json(await createCashTender(db, { merchant: req.merchant!.merchant, orderId: String(req.params.orderId), staffId: req.merchant!.staff.id, tender: req.body }));
  } catch (error) {
    refuse(res, error);
  }
});

router.post('/orders/:orderId/tenders/clear', requireMerchant, async (req: Request, res: Response) => {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  try {
    res.json(await createClearTender(db, clearChargesFor(db), { merchant: req.merchant!.merchant, orderId: String(req.params.orderId), staffId: req.merchant!.staff.id, tender: req.body }));
  } catch (error) {
    refuse(res, error);
  }
});

router.post('/orders/:orderId/void', requireMerchant, async (req: Request, res: Response) => {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  const merchant = req.merchant!.merchant;
  try {
    const { rows } = await db.query<{ timezone: string }>('SELECT timezone FROM merchant.profiles WHERE merchant = $1', [merchant]);
    res.json(
      await voidOrder(
        db,
        {
          card: await connectorForShop(db, merchant),
          clear: clearChargesFor(db),
          pinCheck: async (m, pin) => {
            const s = await staffStore.signInWithPin(m, pin);
            return s ? { id: s.id, role: s.role as Role } : null;
          },
        },
        { merchant, orderId: String(req.params.orderId), staffId: req.merchant!.staff.id, pin: String(req.body?.pin ?? ''), today: businessDate(rows[0]?.timezone ?? 'America/Los_Angeles') },
      ),
    );
  } catch (error) {
    refuse(res, error);
  }
});

router.get('/drawer', requireMerchant, async (req: Request, res: Response) => {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  res.json(await currentDrawer(db, req.merchant!.merchant));
});

router.post('/drawer', requireMerchant, async (req: Request, res: Response) => {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  const starting = req.body?.startingCashCents;
  try {
    res.json(await openDrawer(db, { merchant: req.merchant!.merchant, staffId: req.merchant!.staff.id, startingCashCents: starting === undefined ? undefined : Number(starting) }));
  } catch (error) {
    refuse(res, error);
  }
});

const TipBody = z.object({ tipCents: z.number().int().min(0) });

router.post('/tenders/:id/tip', requireMerchant, async (req: Request, res: Response) => {
  const deps = await ready(res, req.merchant!.merchant);
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
