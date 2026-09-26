import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant, requireOwner } from '../middleware/merchantAuth.js';
import { addBank, BankError, bankAccounts, bankLinkToken, bridgeRail, plaidBank, removeBank } from '../services/merchant/bank/bankService.js';

/**
 * The shop's bank accounts, mounted on /api/merchant.
 *
 *   POST   /bank/link-token     owners: a Plaid Link token
 *   POST   /bank/accounts       owners: the account chosen in Plaid Link, registered with Bridge
 *   GET    /bank/accounts       owners and managers: where withdrawals can go
 *   DELETE /bank/accounts/:id   owners
 */

const router = forwardAsyncErrors(Router());

async function run(res: Response, fn: (db: NonNullable<Awaited<ReturnType<typeof merchantDb>>>) => Promise<unknown>) {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  try {
    const out = await fn(db);
    res.json(out ?? { ok: true });
  } catch (error) {
    if (error instanceof BankError) return res.status(error.status).json({ error: error.code, message: error.message });
    throw error;
  }
}
const m = (req: Request) => req.merchant!.merchant;

router.post('/bank/link-token', requireMerchant, requireOwner, (req, res) => run(res, () => bankLinkToken(plaidBank(), m(req))));
router.post('/bank/accounts', requireMerchant, requireOwner, (req, res) => run(res, (db) => addBank(db, { plaid: plaidBank(), rail: bridgeRail() }, { merchant: m(req), staffId: req.merchant!.staff.id, body: req.body })));
router.get('/bank/accounts', requireMerchant, requireManager, (req, res) => run(res, (db) => bankAccounts(db, m(req))));
router.delete('/bank/accounts/:id', requireMerchant, requireOwner, (req, res) => run(res, (db) => removeBank(db, bridgeRail(), { merchant: m(req), staffId: req.merchant!.staff.id, id: String(req.params.id) })));

export default router;
