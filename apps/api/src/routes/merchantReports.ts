import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant, requireOwner } from '../middleware/merchantAuth.js';
import { feeBills } from '../services/merchant/fees/feeBilling.js';
import { overview } from '../services/merchant/overview.js';
import { auditTrail } from '../services/merchant/security/audit.js';
import { cardDeposits } from '../services/merchant/payouts/payoutSync.js';
import { explainFlag, FlagError, reconciliationView } from '../services/merchant/payouts/reconcile.js';

/**
 * Payouts, reporting and reconciliation (card-processing prompt, Phase 8), mounted on
 * /api/merchant. Owners and managers: these are the shop's money.
 *
 *   GET /card-deposits?from&to      card payouts, with the processor's fee and Clear's fee apart
 *   GET /overview?from&to           sales by method, discounts, tips, tax, refunds, top items, day reports
 *   GET /reconciliation             where our books and the processor's disagree: open, and recently explained
 *   POST /reconciliation/:id/explain  owners and managers: close a flag with what happened
 *   GET /clear-fee-bills            Clear's monthly fee bills (only a processor without a platform fee)
 *   GET /audit?from&to              who did what to the money, and when (owners only: it names
 *                                   everyone's actions and shows blind drawer counts)
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
router.get('/reconciliation', requireMerchant, requireManager, (req, res) => run(res, (db) => reconciliationView(db, m(req))));
router.post('/reconciliation/:id/explain', requireMerchant, requireManager, async (req, res) => {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  try {
    res.json(await explainFlag(db, { merchant: m(req), flagId: String(req.params.id), staffId: req.merchant!.staff.id, body: req.body }));
  } catch (error) {
    if (error instanceof FlagError) return res.status(error.code === 'not_found' ? 404 : 422).json({ error: error.code, message: error.message });
    throw error;
  }
});
router.get('/audit', requireMerchant, requireOwner, (req, res) =>
  run(res, (db) => auditTrail(db, { merchant: m(req), from: date(req.query.from, monthAgo()), to: date(req.query.to, today()) })),
);
router.get('/clear-fee-bills', requireMerchant, requireManager, (req, res) =>
  run(res, async (db) =>
    (await feeBills(db, m(req))).map((b) => ({ id: b.id, period: b.period, amountCents: b.amountCents, status: b.status, txHash: b.txHash, collectedAt: b.collectedAt })),
  ),
);

export default router;
