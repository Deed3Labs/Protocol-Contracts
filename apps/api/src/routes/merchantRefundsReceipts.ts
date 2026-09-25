import type { Role } from '@clear/merchant-contracts';
import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireMerchant } from '../middleware/merchantAuth.js';
import { type RefundRow } from '../services/merchant/cards/cardTenders.js';
import { defaultCardConnector } from '../services/merchant/cards/stripeConnector.js';
import { buildReceipt, ReceiptError, receiptByToken, sendReceipt } from '../services/merchant/orders/receipts.js';
import { decideRefund, RefundError, requestRefund, toRefund } from '../services/merchant/orders/refunds.js';
import { staffStore } from '../services/merchant/staffStore.js';
import { sendNotificationService } from '../services/sendNotificationService.js';
import { merchantAppUrl } from './merchantCards.js';

/**
 * Card and cash refunds, and receipts (card-processing prompt, Phase 6), mounted on /api/merchant.
 * (Clear refunds keep their own routes, /refunds, and flow.)
 *
 *   POST /tender-refunds                 anyone asks; a manager or owner asking approves it too
 *   POST /tender-refunds/:id/decide      approve or decline: a manager's or owner's session, or PIN
 *   GET  /orders/:id/refunds
 *   GET  /orders/:id/receipt             to print or show
 *   POST /orders/:id/receipt             text, email or none
 *   GET  /receipts/:token                public: the receipt behind a link, and nothing else
 */

const REFUND_STATUS: Record<RefundError['code'], number> = {
  not_found: 404,
  invalid: 400,
  not_refundable: 409,
  over_amount: 422,
  items_invalid: 422,
  key_reused: 422,
  clear_flow: 409,
  approver_invalid: 403,
  wrong_state: 409,
  drawer_closed: 409,
};
const RECEIPT_STATUS: Record<ReceiptError['code'], number> = { not_found: 404, invalid: 422, not_paid: 409 };

function refuse(res: Response, error: unknown) {
  if (error instanceof RefundError) return res.status(REFUND_STATUS[error.code]).json({ error: error.code, message: error.message });
  if (error instanceof ReceiptError) return res.status(RECEIPT_STATUS[error.code]).json({ error: error.code, message: error.message });
  throw error;
}

const deps = () => ({
  card: defaultCardConnector(),
  pinCheck: async (merchant: string, pin: string) => {
    const s = await staffStore.signInWithPin(merchant, pin);
    return s ? { id: s.id, role: s.role as Role } : null;
  },
});

/** Where a receipt link points: the merchant app's public receipt page. */
const receiptBase = () => (process.env.RECEIPT_BASE_URL || `${merchantAppUrl()}/r`).trim();

const router = forwardAsyncErrors(Router());

async function run(res: Response, fn: (db: NonNullable<Awaited<ReturnType<typeof merchantDb>>>) => Promise<unknown>) {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  try {
    res.json(await fn(db));
  } catch (error) {
    refuse(res, error);
  }
}

const staff = (req: Request) => ({ id: req.merchant!.staff.id, role: req.merchant!.staff.role as Role });

router.post('/tender-refunds', requireMerchant, (req, res) => run(res, (db) => requestRefund(db, deps(), { merchant: req.merchant!.merchant, staff: staff(req), request: req.body })));
router.post('/tender-refunds/:id/decide', requireMerchant, (req, res) =>
  run(res, (db) =>
    decideRefund(db, deps(), {
      merchant: req.merchant!.merchant,
      refundId: String(req.params.id),
      decision: req.body?.decision === 'decline' ? 'decline' : 'approve',
      pin: typeof req.body?.pin === 'string' ? req.body.pin : null,
      staff: staff(req),
    }),
  ),
);
router.get('/orders/:id/refunds', requireMerchant, (req, res) =>
  run(res, async (db) => {
    const { rows } = await db.query<RefundRow>(
      `SELECT f.* FROM payments.refunds f JOIN payments.tenders t ON t.id = f.tender_id WHERE t.order_id = $1 AND f.merchant = $2 ORDER BY f.created_at`,
      [String(req.params.id), req.merchant!.merchant],
    );
    return rows.map(toRefund);
  }),
);
router.get('/orders/:id/receipt', requireMerchant, (req, res) => run(res, (db) => buildReceipt(db, req.merchant!.merchant, String(req.params.id))));
router.post('/orders/:id/receipt', requireMerchant, (req, res) =>
  run(res, (db) =>
    sendReceipt(
      db,
      {
        send: async ({ by, to, merchantName, total, url }) =>
          Boolean(await sendNotificationService.sendReceipt({ recipientType: by === 'text' ? 'phone' : 'email', recipientContact: to, merchantName, total, receiptUrl: url })),
      },
      { merchant: req.merchant!.merchant, orderId: String(req.params.id), staffId: req.merchant!.staff.id, request: req.body, receiptBaseUrl: receiptBase() },
    ),
  ),
);
router.get('/receipts/:token', (req, res) => run(res, (db) => receiptByToken(db, String(req.params.token))));

export default router;
