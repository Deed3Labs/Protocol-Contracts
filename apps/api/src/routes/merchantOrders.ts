import type { Role } from '@clear/merchant-contracts';
import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireMerchant } from '../middleware/merchantAuth.js';
import * as orders from '../services/merchant/orders/orderService.js';
import { staffStore } from '../services/merchant/staffStore.js';
import { defaultTaxApi } from '../services/merchant/tax/taxApi.js';
import { taxStatus } from '../services/merchant/tax/taxService.js';

/**
 * Orders (card-processing prompt, Phase 6), mounted on /api/merchant.
 *
 *   GET    /orders?date=YYYY-MM-DD        the day's orders (default today)
 *   POST   /orders                        raise one: lines (items with options, or quick sales), customer
 *   GET    /orders/:id
 *   PUT    /orders/:id/lines              change the lines while nothing is paid or being paid
 *   POST   /orders/:id/discount           one per order: a code, or manual with a reason (PIN over the limit)
 *   DELETE /orders/:id/discount
 *   GET    /tax                           Settings › Tax: where tax comes from, the rates at the shop
 *
 * Prices, discounts, tax and totals are the server's; the app sends only what was picked.
 */

const STATUS: Record<orders.OrderError['code'], number> = {
  not_found: 404,
  invalid: 422,
  out_of_stock: 409,
  locked: 409,
  one_discount: 409,
  code_unknown: 422,
  code_not_live: 422,
  code_used: 422,
  code_not_applicable: 422,
  needs_approval: 403,
  approver_invalid: 403,
};

/** A manager's or owner's PIN typed at the counter, checked the way sign-in checks it (rate-limited per shop). */
const pinCheck: orders.PinCheck = async (merchant, pin) => {
  const staff = await staffStore.signInWithPin(merchant, pin);
  return staff ? { id: staff.id, role: staff.role as Role } : null;
};

const deps = (): orders.OrderDeps => ({ taxApi: defaultTaxApi(), pinCheck });

const router = forwardAsyncErrors(Router());

async function run(res: Response, fn: (db: NonNullable<Awaited<ReturnType<typeof merchantDb>>>) => Promise<unknown>) {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  try {
    res.json(await fn(db));
  } catch (error) {
    if (error instanceof orders.OrderError) return res.status(STATUS[error.code]).json({ error: error.code, message: error.message });
    throw error;
  }
}

const m = (req: Request) => req.merchant!.merchant;

router.get('/orders', requireMerchant, (req, res) =>
  run(res, async (db) => {
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : null;
    const { rows } = await db.query<{ timezone: string }>('SELECT timezone FROM merchant.profiles WHERE merchant = $1', [m(req)]);
    return orders.listOrders(db, m(req), date ?? orders.businessDate(rows[0]?.timezone ?? 'America/Los_Angeles'));
  }),
);
router.post('/orders', requireMerchant, (req, res) =>
  run(res, (db) => orders.createOrder(db, deps(), { merchant: m(req), staffId: req.merchant!.staff.id, lines: req.body?.lines, customer: req.body?.customer, name: req.body?.name })),
);
router.get('/orders/:id', requireMerchant, (req, res) => run(res, (db) => orders.getOrder(db, m(req), String(req.params.id))));
router.put('/orders/:id/lines', requireMerchant, (req, res) =>
  run(res, (db) => orders.updateOrder(db, deps(), { merchant: m(req), orderId: String(req.params.id), staffId: req.merchant!.staff.id, lines: req.body?.lines })),
);
router.post('/orders/:id/discount', requireMerchant, (req, res) =>
  run(res, (db) =>
    orders.applyDiscount(db, deps(), { merchant: m(req), orderId: String(req.params.id), staff: { id: req.merchant!.staff.id, role: req.merchant!.staff.role as Role }, request: req.body }),
  ),
);
router.delete('/orders/:id/discount', requireMerchant, (req, res) =>
  run(res, (db) => orders.removeDiscount(db, deps(), { merchant: m(req), orderId: String(req.params.id), staffId: req.merchant!.staff.id })),
);
router.get('/tax', requireMerchant, (req, res) => run(res, (db) => taxStatus(db, defaultTaxApi(), m(req))));

export default router;
