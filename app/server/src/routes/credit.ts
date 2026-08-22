import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { readChainCredit } from '../services/chain/creditReader.js';

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

    res.json({
      wallet: wallet.toLowerCase(),
      tiers: credit.tiers ?? [],
      plans: (credit.plans ?? []).filter((plan) => !plan.closed),
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

export default creditRouter;
