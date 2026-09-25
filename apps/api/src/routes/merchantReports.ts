import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant } from '../middleware/merchantAuth.js';
import { overview } from '../services/merchant/overview.js';
import { cardDeposits } from '../services/merchant/payouts/payoutSync.js';
import { openFlags } from '../services/merchant/payouts/reconcile.js';

/**
 * Payouts, reporting and reconciliation (card-processing prompt, Phase 8), mounted on
 * /api/merchant. Owners and managers: these are the shop's money.
 *
 *   GET /card-deposits?from&to      card payouts, with the processor's fee and Clear's fee apart
 *   GET /overview?from&to           sales by method, discounts, tips, tax, refunds, top items, day reports
 *   GET /reconciliation             where our books and the processor's disagree, open flags
 */

const router = forwardAsyncErrors(Router());
const date = (v: unknown, fallback: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);

async function run(res: Response, fn: (db: NonNullable<Awaited<ReturnType<typeof merchantDb>>>) => Promise<unknown>) {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  res.json(await fn(db));
}
const m = (req: Request) => req.merchant!.merchant;
const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

router.get('/card-deposits', requireMerchant, requireManager, (req, res) =>
  run(res, (db) => cardDeposits(db, { merchant: m(req), from: date(req.query.from, monthAgo()), to: date(req.query.to, today()) })),
);
router.get('/overview', requireMerchant, requireManager, (req, res) => run(res, (db) => overview(db, { merchant: m(req), from: date(req.query.from, monthAgo()), to: date(req.query.to, today()) })));
router.get('/reconciliation', requireMerchant, requireManager, (req, res) => run(res, (db) => openFlags(db, m(req))));

export default router;
