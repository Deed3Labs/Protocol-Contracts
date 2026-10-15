import { Router, type Request, type RequestHandler, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import type { Db } from '../db/db.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { limitByAddress } from '../middleware/rateLimiter.js';
import { connectorForShop } from '../services/merchant/cards/registry.js';
import { TenderError } from '../services/merchant/cards/cardTenders.js';
import { clearChargesFor } from '../services/merchant/orders/clearCharges.js';
import { PaymentError } from '../services/merchant/orders/payments.js';
import { emailReceiptByCode, ReceiptError, receiptByCode } from '../services/merchant/orders/receipts.js';
import { sendNotificationService } from '../services/sendNotificationService.js';
import { TERMINAL_STATUS, TerminalError } from '../services/merchant/terminal/errors.js';
import { menuFor, pointByCode, publicPoint } from '../services/merchant/terminal/pointState.js';
import { phonePageBase, publicJoinWaitlist, publicPay, type PublicPayDeps } from '../services/merchant/terminal/publicPages.js';

/**
 * The phone pages' API (terminal reference, sections 11 and 12). No sign-in. Every request is
 * counted by address across all codes (a four-letter code is easy to guess one at a time), and
 * the ones that act more tightly.
 *
 *   GET  /api/p/:code            what the Point shows: menu, bill, paid or wait list (no names)
 *   GET  /api/p/:code/menu
 *   POST /api/p/:code/pay        {method: 'clear' | 'card'}: a Clear charge, or a card checkout
 *   POST /api/p/:code/waitlist   from a door Point
 *   GET  /api/r/:code            a printed receipt
 *   POST /api/r/:code/email      "Email me this receipt"
 */

export interface PhonePageDeps {
  db: () => Promise<Db | null>;
  pay: (db: Db) => PublicPayDeps;
  sendEmail: (input: { to: string; merchantName: string; total: string; url: string }) => Promise<boolean>;
  limits: { read: RequestHandler; act: RequestHandler };
}

export const defaultPhonePageDeps = (): PhonePageDeps => ({
  db: merchantDb,
  pay: (db) => ({ clear: clearChargesFor(db), card: (merchant) => connectorForShop(db, merchant) }),
  sendEmail: async ({ to, merchantName, total, url }) =>
    Boolean(await sendNotificationService.sendReceipt({ recipientType: 'email', recipientContact: to, merchantName, total, receiptUrl: url })),
  limits: { read: limitByAddress('phone-pages', 60_000, 120), act: limitByAddress('phone-pages-act', 60_000, 10) },
});

function runWith(deps: PhonePageDeps) {
  return (fn: (db: Db, req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    const db = await deps.db();
    if (!db) return res.status(503).json({ error: 'Unavailable', message: 'not available right now' });
    // Bills change by the second; nothing here may be cached by a browser or a worker.
    res.setHeader('Cache-Control', 'no-store');
    try {
      const out = await fn(db, req);
      if (out === undefined) return res.status(204).end();
      return res.json(out);
    } catch (error) {
      if (error instanceof TerminalError) return res.status(TERMINAL_STATUS[error.code]).json({ error: error.code, message: error.message });
      if (error instanceof ReceiptError) return res.status(error.code === 'not_found' ? 404 : error.code === 'too_many' ? 429 : 422).json({ error: error.code, message: error.message });
      if (error instanceof PaymentError || error instanceof TenderError) return res.status(409).json({ error: error.code, message: error.message });
      throw error;
    }
  };
}

export function pointPageRouter(deps: PhonePageDeps = defaultPhonePageDeps()): Router {
  const router = forwardAsyncErrors(Router());
  const run = runWith(deps);
  const code = (req: Request) => String(req.params.code);
  router.use(deps.limits.read);
  router.get('/:code', run((db, req) => publicPoint(db, code(req))));
  router.get('/:code/menu', run(async (db, req) => {
    const p = await pointByCode(db, code(req));
    if (!p) throw new TerminalError('No Point has that code', 'not_found');
    return menuFor(db, p.merchant);
  }));
  router.post('/:code/pay', deps.limits.act, run((db, req) => publicPay(db, deps.pay(db), { code: code(req), request: req.body })));
  router.post('/:code/waitlist', deps.limits.act, run((db, req) => publicJoinWaitlist(db, { code: code(req), request: req.body })));
  return router;
}

export function receiptPageRouter(deps: PhonePageDeps = defaultPhonePageDeps()): Router {
  const router = forwardAsyncErrors(Router());
  const run = runWith(deps);
  router.use(deps.limits.read);
  router.get('/:code', run((db, req) => receiptByCode(db, String(req.params.code))));
  router.post('/:code/email', deps.limits.act, run(async (db, req) => {
    await emailReceiptByCode(db, { send: ({ to, merchantName, total, url }) => deps.sendEmail({ to, merchantName, total, url }) }, {
      code: String(req.params.code),
      request: req.body,
      receiptBaseUrl: `${phonePageBase()}/r`,
    });
    return undefined;
  }));
  return router;
}
