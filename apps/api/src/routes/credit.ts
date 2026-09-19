import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { readChainCredit } from '../services/chain/creditReader.js';
import { readChainEarn } from '../services/chain/earnReader.js';
import { chargeStore } from '../services/chargeStore.js';
import { heldDrawsByTier } from '../services/lithic/cardTransactionsService.js';
import { recordUsdcRepayment } from '../services/chain/usdcRepaymentService.js';
import { autoRepayStatus, setAutoRepayChoice } from '../services/chain/autoRepayService.js';
import { repaymentHistory } from '../services/credit/repaymentHistory.js';

/*
 * A member's credit line, assembled from the contracts that hold it.
 *
 * The app reads this rather than the chain directly, for a reason that is not merely consistency:
 * two of the four tiers do not exist on-chain at all. Income and Boost are underwritten off-chain
 * and reach the chain as attestations, so a client reading contracts would get a credit line
 * missing half its tiers and no way to know it.
 *
 * It is also the same snapshot the card authorization path will read. Authorization has ~200ms and
 * cannot wait for an RPC round trip, so the chain is authoritative for what is *owed* and this is
 * authoritative for what can be *spent right now* (build plan §4). One source, two readers.
 *
 * Amounts are cents throughout. The app's model is in whole units, so the conversion happens at
 * the edge rather than here -- cents keep the arithmetic integral all the way through.
 */
const creditRouter = Router();

creditRouter.get('/:wallet', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;

  try {
    const credit = await readChainCredit(wallet);

    // A failed read is reported, never smoothed into zeroes. A member whose RPC blipped has not
    // had their credit line withdrawn, and a client that cannot tell the difference will show
    // them that it has.
    if (!credit.complete) {
      res.status(503).json({
        error: 'Credit state unavailable',
        message: 'Could not read the credit contracts. This is not a zero balance.',
        complete: false,
      });
      return;
    }

    const open = (credit.plans ?? []).filter((plan) => !plan.closed);

    // The one thing on this route that is not from chain, and it is labelled as such below. A plan
    // knows its merchant's address; only the charge that opened it knows the name a member would
    // recognise. Best-effort: a shelf row with no name is a plan without a label, which is worse
    // than the alternative but far better than failing the whole credit read over it.
    const merchantNames = await chargeStore
      .merchantNamesByPlanId(open.map((plan) => plan.planId))
      .catch(() => ({} as Record<number, string>));

    res.json({
      wallet: wallet.toLowerCase(),
      tiers: credit.tiers ?? [],
      plans: open.map((plan) => ({ ...plan, merchantName: merchantNames[plan.planId] ?? null })),
      cycle: credit.cycle,
      // The ceiling a split plan is actually checked against, which is not the tiers. A screen
      // that offers to split a purchase has to quote this one; the tier total belongs to the
      // revolving line and promises room a plan cannot use.
      term: credit.term,
      // What of a member's savings cannot leave. Carried because it is not derivable from the
      // tiers: encumbrance follows what is drawn, not what is pledged.
      savingsEncumberedCents: credit.savingsEncumberedCents,
      /*
       * Card authorizations the member is holding right now, per tier — OFF CHAIN, deliberately.
       *
       * An authorization is a hold, not a settled borrow, and the contracts are right not to carry
       * it: it can still be voided, and most of the ones made while testing this were. But it is
       * unavailable to the member from the instant it is approved, and reading only the chain told
       * them otherwise — a live $5 charge against a line reading "$0 used · not drawn".
       *
       * Kept separate from the chain's `usedCents` rather than folded into it. They are different
       * facts, and the day they are merged is the day nobody can tell which is which.
       */
      pendingCardDraws: await heldDrawsByTier(wallet),
      // Named rather than implied: the tiers came from chain, and the tiers the chain does not know
      // about are absent rather than zero. `pendingCardDraws` above is the one field that did not.
      source: 'chain',
      complete: true,
    });
  } catch (error) {
    console.error('[credit] read failed', error);
    res.status(500).json({
      error: 'Failed to read credit',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * The Earn page: the lending pool and the member's bonds.
 *
 * On the credit router rather than its own because it is the same question from the other side --
 * what a member holds that backs their limit. Bonds and pool shares are collateral before they are
 * products, and reading them through two routes would be two chances for the figures to disagree.
 */
creditRouter.get('/:wallet/earn', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;

  try {
    const earn = await readChainEarn(wallet);

    if (!earn.complete) {
      res.status(503).json({
        error: 'Earn state unavailable',
        message: 'Could not read the bond or pool contracts. This is not an empty portfolio.',
        complete: false,
      });
      return;
    }

    res.json({
      wallet: wallet.toLowerCase(),
      // Null when the pool is not deployed on this chain, which is a different thing from a pool
      // holding nothing -- the caller keeps its placeholder rather than showing an empty product.
      pool: earn.pool,
      bonds: (earn.bonds ?? []).filter((bond) => !bond.redeemed),
      terms: earn.terms ?? [],
      earnedToDateCents: earn.earnedToDateCents,
      source: 'chain',
      complete: true,
    });
  } catch (error) {
    console.error('[earn] read failed', error);
    res.status(500).json({
      error: 'Failed to read earn state',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/** GET /api/credit/:wallet/repayments — every repayment, whichever way it was made. */
creditRouter.get('/:wallet/repayments', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;
  try {
    return res.json({ repayments: await repaymentHistory(wallet) });
  } catch (error) {
    console.error('[credit] repayment history failed', error);
    return res.status(500).json({ error: 'Failed to read repayments' });
  }
});

/**
 * POST /api/credit/:wallet/repayments { txHash } — the member repaid on chain; record it.
 * The amount comes from the transaction's own events, never from the request.
 */
creditRouter.post('/:wallet/repayments', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;
  try {
    const result = await recordUsdcRepayment(wallet, String(req.body?.txHash ?? ''));
    if (!result.ok) return res.status(400).json({ error: 'Not recorded', message: result.reason });
    return res.json(result);
  } catch (error) {
    console.error('[credit] repayment record failed', error);
    return res.status(500).json({ error: 'Failed to record repayment' });
  }
});

/** GET/POST /api/credit/:wallet/auto-repay — automatic repayment from USDC deposits. */
creditRouter.get('/:wallet/auto-repay', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;
  try {
    return res.json(await autoRepayStatus(wallet));
  } catch (error) {
    console.error('[credit] auto-repay status failed', error);
    return res.status(500).json({ error: 'Failed to read' });
  }
});

creditRouter.post('/:wallet/auto-repay', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;
  try {
    // Recorded only once the member's own wallet has set it on chain -- never on the request's word.
    const result = await setAutoRepayChoice(wallet, req.body?.enabled === true);
    if (!result.ok) return res.status(409).json({ error: 'Not set', message: result.reason });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[credit] auto-repay set failed', error);
    return res.status(500).json({ error: 'Failed to set' });
  }
});

export default creditRouter;
