import { Router, type Request, type RequestHandler, type Response } from 'express';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant, requireOwner } from '../middleware/merchantAuth.js';
import { cancelHardwareLine, HardwareOrderError, hardwareOrders, shopStripe, type ShopStripe } from '../services/merchant/hardwareOrders/hardwareOrdersService.js';

/**
 * Settings › Devices › On order (services/merchant/hardwareOrders), mounted on /api/merchant.
 *
 *   GET  /hardware/orders                      owners and managers: the shop's reservations on
 *                                              useclear.org, each line's deposit, ship month, status
 *   POST /hardware/orders/:id/lines/:n/cancel  owners: refund a line's deposit, before building starts
 *
 * Deposits are the shop's money, so the list is a manager's and the refund an owner's, as payouts are.
 */

export type HardwareOrdersDeps = {
  stripe: () => ShopStripe | null;
  auth: { merchant: RequestHandler; manager: RequestHandler; owner: RequestHandler };
};

const defaults: HardwareOrdersDeps = { stripe: () => shopStripe(), auth: { merchant: requireMerchant, manager: requireManager, owner: requireOwner } };

export function merchantHardwareOrdersRouter(deps: HardwareOrdersDeps = defaults) {
  const router = forwardAsyncErrors(Router());

  router.get('/hardware/orders', deps.auth.merchant, deps.auth.manager, async (req: Request, res: Response) => {
    res.json(await hardwareOrders(deps.stripe(), req.merchant!.merchant));
  });

  router.post('/hardware/orders/:id/lines/:n/cancel', deps.auth.merchant, deps.auth.owner, async (req: Request, res: Response) => {
    const stripe = deps.stripe();
    if (!stripe) {
      res.status(503).json({ error: 'not_configured', message: 'Hardware orders aren’t connected yet.' });
      return;
    }
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      res.status(404).json({ error: 'not_found', message: 'No such line on that order.' });
      return;
    }
    try {
      await cancelHardwareLine(stripe, req.merchant!.merchant, String(req.params.id), n);
    } catch (error) {
      if (error instanceof HardwareOrderError) {
        res.status(error.status).json({ error: error.code, message: error.message });
        return;
      }
      throw error;
    }
    res.json(await hardwareOrders(stripe, req.merchant!.merchant));
  });

  return router;
}
