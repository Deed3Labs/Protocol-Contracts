import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant, requireOwner } from '../middleware/merchantAuth.js';
import { connectorForShop } from '../services/merchant/cards/registry.js';
import { setupProgress } from '../services/merchant/setup/setupService.js';
import { bridgeKyb, KybError, kybStatus, startKyb } from '../services/merchant/kyb/kybService.js';
import { getHours, getSettings, getShop, saveHours, ShopError, updateSettings, updateShop } from '../services/merchant/shop/shopService.js';

/**
 * The shop and its settings (card-processing prompt, Phase 5), mounted on /api/merchant.
 *
 *   GET   /shop        any signed-in staff: name, address, timezone, card plan, Clear tier
 *   PATCH /shop        owners: address (sets sales tax and the reader location), timezone, name and
 *                      the listing (what the shop does, a line about it, phone, email)
 *   GET   /shop/hours  any signed-in staff: the usual week and the dates that differ
 *   PUT   /shop/hours  owners
 *   GET   /settings    any signed-in staff: the counter's screens follow these (payment methods,
 *                      tips, offline cards and their limit, discount limits)
 *   PATCH /settings    owners
 *   GET   /setup       owners and managers: Home's Set up the till, which steps are done
 *   GET   /kyb         owners and managers: the business's verification with Bridge
 *   POST  /kyb/start   owners: Bridge's hosted verification link
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
    res.json(await updateShop(d, await connectorForShop(d, req.merchant!.merchant), { merchant: req.merchant!.merchant, patch: req.body }));
  } catch (error) {
    refuse(res, error);
  }
});

router.get('/shop/hours', requireMerchant, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  res.json(await getHours(d, req.merchant!.merchant));
});

router.put('/shop/hours', requireMerchant, requireOwner, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  try {
    res.json(await saveHours(d, { merchant: req.merchant!.merchant, hours: req.body }));
  } catch (error) {
    refuse(res, error);
  }
});

router.get('/kyb', requireMerchant, requireManager, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  res.json(await kybStatus(d, bridgeKyb(), req.merchant!.merchant));
});

router.post('/kyb/start', requireMerchant, requireOwner, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  try {
    res.json(await startKyb(d, bridgeKyb(), { merchant: req.merchant!.merchant, staffId: req.merchant!.staff.id, body: req.body, appUrl: process.env.MERCHANT_APP_URL || 'https://merchant.useclear.org' }));
  } catch (error) {
    if (error instanceof KybError) return void res.status(error.status).json({ error: error.code, message: error.message });
    throw error;
  }
});

router.get('/setup', requireMerchant, requireManager, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  res.json(await setupProgress(d, req.merchant!.merchant));
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
