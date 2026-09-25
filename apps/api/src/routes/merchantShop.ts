import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireMerchant, requireOwner } from '../middleware/merchantAuth.js';
import { defaultCardConnector } from '../services/merchant/cards/stripeConnector.js';
import { getSettings, getShop, ShopError, updateSettings, updateShop } from '../services/merchant/shop/shopService.js';

/**
 * The shop and its settings (card-processing prompt, Phase 5), mounted on /api/merchant.
 *
 *   GET   /shop        any signed-in staff: name, address, timezone, card plan, Clear tier
 *   PATCH /shop        owners: address (sets sales tax and the reader location) and timezone
 *   GET   /settings    any signed-in staff: the counter's screens follow these (payment methods,
 *                      tips, offline cards and their limit, discount limits)
 *   PATCH /settings    owners
 */

const router = forwardAsyncErrors(Router());

function refuse(res: Response, error: unknown): void {
  if (error instanceof ShopError) {
    res.status(error.code === 'not_found' ? 404 : 422).json({ error: error.code, message: error.message });
    return;
  }
  throw error;
}

async function db(res: Response) {
  const d = await merchantDb();
  if (!d) res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  return d;
}

router.get('/shop', requireMerchant, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  try {
    res.json(await getShop(d, req.merchant!.merchant));
  } catch (error) {
    refuse(res, error);
  }
});

router.patch('/shop', requireMerchant, requireOwner, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  try {
    res.json(await updateShop(d, defaultCardConnector(), { merchant: req.merchant!.merchant, patch: req.body }));
  } catch (error) {
    refuse(res, error);
  }
});

router.get('/settings', requireMerchant, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  try {
    res.json(await getSettings(d, req.merchant!.merchant));
  } catch (error) {
    refuse(res, error);
  }
});

router.patch('/settings', requireMerchant, requireOwner, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  try {
    res.json(await updateSettings(d, { merchant: req.merchant!.merchant, staffId: req.merchant!.staff.id, patch: req.body }));
  } catch (error) {
    refuse(res, error);
  }
});

export default router;
