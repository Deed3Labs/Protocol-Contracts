import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { withdrawToBank } from '../services/withdrawService.js';

/*
 * Withdraw (cash-out) — USDC on Base → a Plaid-linked bank via Bridge off-ramp. Wallet-scoped
 * (requireWalletMatch), mounted under requireAuth. See services/withdrawService.ts.
 */
const router = Router();

const wallet = (req: Request) => String(req.params.wallet || '').toLowerCase();

// POST /api/withdraw/:wallet  { amount, plaidAccountId, email }
router.post('/:wallet', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;

  const b = req.body as { amount?: number | string; plaidAccountId?: string; rail?: string };
  const amountUsd = Number(b?.amount);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    res.status(400).json({ error: 'A positive amount is required' });
    return;
  }

  try {
    const result = await withdrawToBank({
      wallet: w,
      // Resolved from the session, never the body — the caller can't point a payout at someone
      // else's Bridge customer by passing their email.
      emails: req.auth?.emails ?? (req.auth?.email ? [req.auth.email] : []),
      plaidAccountId: String(b?.plaidAccountId ?? ''),
      amountUsd,
      rail: b?.rail === 'ach_same_day' ? 'ach_same_day' : 'ach',
    });
    if (!result.success) {
      // notConfigured → 503 so the UI can show a friendly "coming soon"; other failures → 400.
      res.status(result.notConfigured ? 503 : 400).json({
        error: result.reason || 'Withdrawal failed',
        notConfigured: Boolean(result.notConfigured),
      });
      return;
    }
    // depositAddress/depositAmount are not optional extras: the client MUST send USDC there or the
    // transfer never leaves `awaiting_funds`.
    res.json({
      success: true,
      providerReference: result.providerReference,
      status: result.status,
      depositAddress: result.depositAddress,
      depositAmount: result.depositAmount,
    });
  } catch (error) {
    console.error('[withdraw]', error);
    res.status(500).json({ error: 'Failed to create withdrawal' });
  }
});

export default router;
