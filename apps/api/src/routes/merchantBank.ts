import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant, requireOwner } from '../middleware/merchantAuth.js';
import { addBank, BankError, bankAccounts, bankLinkToken, bridgeRail, plaidBank, removeBank } from '../services/merchant/bank/bankService.js';
import { bridgeReceive, emailReceive, openReceive, ReceiveError, receiveDetails, sendReceiveEmail } from '../services/merchant/bank/receiveService.js';

/**
 * The shop's bank accounts, mounted on /api/merchant.
 *
 *   POST   /bank/link-token     owners: a Plaid Link token
 *   POST   /bank/accounts       owners: the account chosen in Plaid Link, registered with Bridge
 *   GET    /bank/accounts       owners and managers: where withdrawals can go
 *   DELETE /bank/accounts/:id   owners
 *   GET    /receive             owners and managers: the account and routing numbers to be paid at
 *   POST   /receive             owners: open them, once the business is verified
 *   POST   /receive/email       owners and managers: email them to the business's address
 */

const router = forwardAsyncErrors(Router());

async function run(res: Response, fn: (db: NonNullable<Awaited<ReturnType<typeof merchantDb>>>) => Promise<unknown>) {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  try {
    const out = await fn(db);
    res.json(out ?? { ok: true });
  } catch (error) {
    if (error instanceof BankError || error instanceof ReceiveError) return res.status(error.status).json({ error: error.code, message: error.message });
    throw error;
  }
}
const m = (req: Request) => req.merchant!.merchant;

router.post('/bank/link-token', requireMerchant, requireOwner, (req, res) => run(res, (db) => bankLinkToken(db, { plaid: plaidBank(), rail: bridgeRail() }, m(req))));
router.post('/bank/accounts', requireMerchant, requireOwner, (req, res) => run(res, (db) => addBank(db, { plaid: plaidBank(), rail: bridgeRail() }, { merchant: m(req), staffId: req.merchant!.staff.id, body: req.body })));
router.get('/bank/accounts', requireMerchant, requireManager, (req, res) => run(res, (db) => bankAccounts(db, m(req))));
router.delete('/bank/accounts/:id', requireMerchant, requireOwner, (req, res) => run(res, (db) => removeBank(db, bridgeRail(), { merchant: m(req), staffId: req.merchant!.staff.id, id: String(req.params.id) })));

router.get('/receive', requireMerchant, requireManager, (req, res) => run(res, (db) => receiveDetails(db, bridgeReceive(), m(req))));
router.post('/receive', requireMerchant, requireOwner, (req, res) => run(res, (db) => openReceive(db, bridgeReceive(), { merchant: m(req), staffId: req.merchant!.staff.id })));
router.post('/receive/email', requireMerchant, requireManager, (req, res) => run(res, (db) => emailReceive(db, bridgeReceive(), sendReceiveEmail, { merchant: m(req), staffId: req.merchant!.staff.id })));

export default router;
