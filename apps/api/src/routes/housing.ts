import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { requireStepUpWhen } from '../middleware/stepUp.js';
import {
  HousingError,
  liveHousingChain,
  parseHomeId,
  prepareContribute,
  prepareRedeem,
  readHousing,
  submitRedeem,
  type HousingChain,
} from '../services/housing/housingService.js';

/*
 * A member's Housing Allowance (services/housing/housingService).
 *
 *   GET  /api/housing/:wallet                       every home this wallet has a record on
 *   POST /api/housing/:homeId/redeem-credits        { wallet, credits }                         → what to sign
 *   POST /api/housing/:homeId/redeem-credits        { wallet, credits, deadline, signature }    → submitted (step-up)
 *   POST /api/housing/:homeId/contribute            { wallet, usd }                             → the calls the wallet sends
 *
 * Opening a record, fiat payments, moves, ends and price changes are proposed in Command and signed by
 * the Clear Treasury Safe; nothing here writes them.
 */

let chainFor: () => HousingChain | null = () => liveHousingChain();
/** Tests swap the chain. */
export function setHousingChain(f: () => HousingChain | null): void {
  chainFor = f;
}

const router = Router();

function chain(res: Response): HousingChain | null {
  const c = chainFor();
  if (!c) res.status(503).json({ error: 'The Housing Allowance Record isn’t deployed on this network' });
  return c;
}

function fail(res: Response, where: string, error: unknown): void {
  if (error instanceof HousingError) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return;
  }
  console.error(`[housing/${where}]`, (error as Error)?.message);
  res.status(502).json({ error: 'Could not reach the chain' });
}

router.get('/:wallet', async (req: Request, res: Response) => {
  const w = String(req.params.wallet || '').toLowerCase();
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  const c = chain(res);
  if (!c) return;
  try {
    res.json(await readHousing(c, w));
  } catch (error) {
    fail(res, 'read', error);
  }
});

/** A signature makes it a submission, and a submission takes a recent step-up. */
const stepUpIfSigned = requireStepUpWhen((req) => Boolean(req.body?.signature));

router.post('/:homeId/redeem-credits', stepUpIfSigned, async (req: Request, res: Response) => {
  const w = String(req.body?.wallet || '').toLowerCase();
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  const c = chain(res);
  if (!c) return;
  try {
    const homeId = parseHomeId(req.params.homeId);
    const credits = Number(req.body?.credits);
    if (req.body?.signature) {
      res.json(await submitRedeem(c, w, homeId, credits, String(req.body.deadline ?? ''), String(req.body.signature)));
    } else {
      res.json(await prepareRedeem(c, w, homeId, credits));
    }
  } catch (error) {
    fail(res, 'redeem', error);
  }
});

router.post('/:homeId/contribute', async (req: Request, res: Response) => {
  const w = String(req.body?.wallet || '').toLowerCase();
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  const c = chain(res);
  if (!c) return;
  try {
    res.json(await prepareContribute(c, w, parseHomeId(req.params.homeId), Number(req.body?.usd)));
  } catch (error) {
    fail(res, 'contribute', error);
  }
});

export default router;
