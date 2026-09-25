import type { Role } from '@clear/merchant-contracts';
import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant } from '../middleware/merchantAuth.js';
import { connectorForShop } from '../services/merchant/cards/registry.js';
import * as close from '../services/merchant/drawer/closeService.js';
import { staffStore } from '../services/merchant/staffStore.js';

/**
 * Counting the drawer and Close the day (card-processing prompt, Phase 7), mounted on /api/merchant.
 *
 *   GET  /drawer/:id/counts          what the viewer may see: their own count until both are in
 *   POST /drawer/:id/counts          save a count (the second is someone else's)
 *   POST /drawer/:id/recount         the counts disagree: whoever made one counts again
 *   POST /drawer/:id/signoff         a difference, signed by a manager or owner (not the first counter), by PIN
 *   POST /drawer/:id/close           captures cards, pays cash tips, leaves the float, writes the day report
 *   GET  /bank-deposits              managers: what's gone to the bank, unmarked first
 *   POST /bank-deposits/:id/deposited
 *   GET  /day-reports?from&to        managers
 *   GET  /tips/mine                  what I'm owed in tips
 */

const STATUS: Record<close.CloseError['code'], number> = {
  not_found: 404,
  invalid: 400,
  closed: 409,
  both_counted: 409,
  someone_else: 409,
  not_compared: 409,
  counts_disagree: 409,
  no_difference: 409,
  signer_invalid: 403,
  unsigned: 409,
  orders_open: 409,
  counts_needed: 409,
};

const router = forwardAsyncErrors(Router());

async function run(res: Response, fn: (db: NonNullable<Awaited<ReturnType<typeof merchantDb>>>) => Promise<unknown>) {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  try {
    res.json(await fn(db));
  } catch (error) {
    if (error instanceof close.CloseError) return res.status(STATUS[error.code]).json({ error: error.code, message: error.message });
    throw error;
  }
}

const m = (req: Request) => req.merchant!.merchant;
const me = (req: Request) => req.merchant!.staff.id;
const pinCheck = async (merchant: string, pin: string) => {
  const s = await staffStore.signInWithPin(merchant, pin);
  return s ? { id: s.id, role: s.role as Role } : null;
};

router.get('/drawer/:id/counts', requireMerchant, (req, res) => run(res, (db) => close.counts(db, { merchant: m(req), sessionId: String(req.params.id), viewer: me(req) })));
router.post('/drawer/:id/counts', requireMerchant, (req, res) => run(res, (db) => close.saveCount(db, { merchant: m(req), sessionId: String(req.params.id), staffId: me(req), count: req.body })));
router.post('/drawer/:id/recount', requireMerchant, (req, res) =>
  run(res, (db) => close.recount(db, { merchant: m(req), sessionId: String(req.params.id), staffId: me(req), which: req.body?.which === 'second' ? 'second' : 'first' })),
);
router.post('/drawer/:id/signoff', requireMerchant, (req, res) => run(res, (db) => close.signOff(db, { pinCheck }, { merchant: m(req), sessionId: String(req.params.id), staffId: me(req), signOff: req.body })));
router.post('/drawer/:id/close', requireMerchant, (req, res) => run(res, async (db) => close.closeDay(db, { card: await connectorForShop(db, m(req)) }, { merchant: m(req), sessionId: String(req.params.id), staffId: me(req) })));
router.get('/bank-deposits', requireMerchant, requireManager, (req, res) => run(res, (db) => close.bankDeposits(db, m(req))));
router.post('/bank-deposits/:id/deposited', requireMerchant, requireManager, (req, res) => run(res, (db) => close.markDeposited(db, { merchant: m(req), depositId: String(req.params.id), staffId: me(req) })));
router.get('/day-reports', requireMerchant, requireManager, (req, res) =>
  run(res, (db) => {
    const date = (v: unknown, fallback: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
    return close.dayReports(db, { merchant: m(req), from: date(req.query.from, '1970-01-01'), to: date(req.query.to, '9999-12-31') });
  }),
);
router.get('/tips/mine', requireMerchant, (req, res) => run(res, async (db) => ({ owedCents: await close.tipsOwed(db, m(req), me(req)) })));

export default router;
