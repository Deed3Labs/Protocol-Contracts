import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { readChainCredit } from '../services/chain/creditReader.js';
import { readChainEarn } from '../services/chain/earnReader.js';
import { chargeStore } from '../services/chargeStore.js';
import { heldDrawsByTier } from '../services/lithic/cardTransactionsService.js';
import { recordUsdcRepayment } from '../services/chain/usdcRepaymentService.js';
import { autoRepayStatus, setAutoRepayChoice } from '../services/chain/autoRepayService.js';
import { repaymentHistory } from '../services/credit/repaymentHistory.js';
import { prepareResplit, submitResplit } from '../services/planResplit.js';
import {
  prepareAutoClear,
  prepareSavingsDrawAllowance,
  submitAutoClear,
  submitSavingsDrawAllowance,
} from '../services/chain/memberSwitches.js';
import { requireStepUp } from '../middleware/stepUp.js';

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
      // Phase 2: lines and plans need an attested state. False means "not confirmed yet", which the
      // app says in those words rather than as a refusal. Null: unread, or a pre-Phase 2 network.
      stateConfirmed: credit.stateConfirmed,
      // Phase 2b (12.3-12.5): Clean Cycles, a missed cycle or a cure notice, the Boost cap, and any
      // excess over a halved limit. Null on an issuer from before Phase 2b.
      standing: credit.standing,
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
    // Phase 2b: the scope travels with the switch (0 = income-backed and Boost only, 1 = everything).
    const scope = req.body?.scope === 0 || req.body?.scope === 1 ? Number(req.body.scope) : undefined;
    const result = await setAutoRepayChoice(wallet, req.body?.enabled === true, scope);
    if (!result.ok) return res.status(409).json({ error: 'Not set', message: result.reason });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[credit] auto-repay set failed', error);
    return res.status(500).json({ error: 'Failed to set' });
  }
});

/*
 * Re-splitting a plan when it costs more (Phase 2, spec item 6). `prepare` says whether the new
 * split needs the member's signature; when it does not, the member's wallet calls `setSplit` as
 * before. When it does, the phone signs `Resplit` and posts it here, and the operator submits
 * `resplitWithSignature`. Changing what a member owes takes a fresh Face ID, like approving a plan.
 */
function planParams(req: Request, res: Response): { planId: number; installments: number } | null {
  const planId = Number(req.params.planId);
  const installments = Number(req.body?.installments);
  if (!Number.isInteger(planId) || planId < 0 || !Number.isInteger(installments) || installments < 1) {
    res.status(400).json({ error: 'Invalid split', message: 'planId and installments must be whole numbers.' });
    return null;
  }
  return { planId, installments };
}

creditRouter.post('/:wallet/plans/:planId/split/prepare', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;
  const params = planParams(req, res);
  if (!params) return;
  const result = await prepareResplit(wallet, params.planId, params.installments);
  if (!result.ok) return res.status(409).json({ error: 'Could not prepare', message: result.reason });
  return res.json(result);
});

creditRouter.post('/:wallet/plans/:planId/split', requireStepUp, async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;
  const params = planParams(req, res);
  if (!params) return;
  const result = await submitResplit(wallet, params.planId, {
    installments: params.installments,
    rateBps: String(req.body?.rateBps ?? ''),
    deadline: Number(req.body?.deadline),
    signature: String(req.body?.signature ?? ''),
  });
  if (!result.ok) return res.status(409).json({ error: 'Could not change the split', message: result.reason });
  return res.json(result);
});

/*
 * The member's own switches, signed (Phase 2b): auto-clear on/off and scope (12.2), and how much card
 * spending may draw against Savings (12.7). `prepare` returns the EIP-712 typed data at the member's
 * `memberNonces`; the phone signs it; the POST submits it. Onboarding turns auto-clear on this way.
 */
creditRouter.post('/:wallet/auto-clear/prepare', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;
  const result = await prepareAutoClear(wallet, req.body?.on === true, Number(req.body?.scope ?? 0));
  if (!result.ok) return res.status(409).json({ error: 'Could not prepare', message: result.reason });
  return res.json(result);
});

creditRouter.post('/:wallet/auto-clear', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;
  const result = await submitAutoClear(wallet, {
    on: req.body?.on === true,
    scope: Number(req.body?.scope ?? 0),
    deadline: Number(req.body?.deadline),
    signature: String(req.body?.signature ?? ''),
  });
  if (!result.ok) return res.status(409).json({ error: 'Not set', message: result.reason });
  return res.json(result);
});

creditRouter.post('/:wallet/savings-draw-allowance/prepare', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;
  let amount: bigint;
  try {
    amount = BigInt(String(req.body?.amount ?? '0'));
  } catch {
    return res.status(400).json({ error: 'Invalid amount', message: 'amount must be whole ledger units.' });
  }
  const result = await prepareSavingsDrawAllowance(wallet, amount);
  if (!result.ok) return res.status(409).json({ error: 'Could not prepare', message: result.reason });
  return res.json(result);
});

// Raising what card spending may take from Savings is a money permission: a fresh Face ID.
creditRouter.post('/:wallet/savings-draw-allowance', requireStepUp, async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;
  const result = await submitSavingsDrawAllowance(wallet, {
    amount: String(req.body?.amount ?? ''),
    deadline: Number(req.body?.deadline),
    signature: String(req.body?.signature ?? ''),
  });
  if (!result.ok) return res.status(409).json({ error: 'Not set', message: result.reason });
  return res.json(result);
});

export default creditRouter;
