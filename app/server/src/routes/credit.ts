import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { readChainCredit } from '../services/chain/creditReader.js';
import { readChainEarn } from '../services/chain/earnReader.js';
import { chargeStore } from '../services/chargeStore.js';

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
      // Named rather than implied: everything here came from chain, and the tiers the chain does
      // not know about are absent rather than zero. The caller decides what to do about that.
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

export default creditRouter;
