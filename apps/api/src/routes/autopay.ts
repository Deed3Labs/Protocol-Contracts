import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { autopayStore, type AutopayCadence } from '../services/autopayStore.js';
import { executeAutopayRule, isAutopayExecutorConfigured, type DepositMandate } from '../services/autopayService.js';
import { savingsGaslessService } from '../services/savingsGaslessService.js';
import { savingsRelayerService } from '../services/savingsRelayerService.js';

/*
 * Autopay rules — recurring gasless savings deposits via a ZeroDev session. Wallet-scoped
 * (requireWalletMatch), mounted under requireAuth. The client installs the session (signs once) and
 * posts the serialized permission account here; the runner (jobs/autopayRunner) executes it.
 */
const router = Router();

const wallet = (req: Request) => String(req.params.wallet || '').toLowerCase();
const CADENCES = new Set<AutopayCadence>(['weekly', 'monthly']);

function ensureReady(res: Response): boolean {
  if (!autopayStore.isConfigured()) {
    res.status(503).json({ error: 'Autopay store not configured' });
    return false;
  }
  return true;
}

// GET /api/autopay/:wallet
router.get('/:wallet', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  try {
    res.json({ rules: await autopayStore.listForWallet(w) });
  } catch (error) {
    console.error('[autopay/list]', error);
    res.status(500).json({ error: 'Failed to load autopay rules' });
  }
});

// POST /api/autopay/:wallet  { chainId, amountUsdc, cadence, approval, runs? }
router.post('/:wallet', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;

  const b = req.body as {
    chainId?: number;
    amountUsdc?: number;
    cadence?: string;
    runs?: number;
    mandate?: DepositMandate;
    permit?: { value?: string; deadline?: number; v?: number; r?: string; s?: string };
  };
  const chainId = Number(b?.chainId);
  const amountUsdc = Number(b?.amountUsdc);
  const cadence = String(b?.cadence ?? '') as AutopayCadence;
  const mandate = b?.mandate;

  if (!Number.isFinite(chainId) || chainId <= 0) {
    res.status(400).json({ error: 'A valid chainId is required' });
    return;
  }
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    res.status(400).json({ error: 'A positive amountUsdc is required' });
    return;
  }
  if (!CADENCES.has(cadence)) {
    res.status(400).json({ error: 'cadence must be weekly or monthly' });
    return;
  }
  if (!mandate || mandate.depositor?.toLowerCase() !== w || !mandate.token || !mandate.signature) {
    res.status(400).json({ error: 'A valid signed mandate is required' });
    return;
  }
  const runsLeft = Number.isFinite(Number(b?.runs)) && Number(b?.runs) > 0 ? Math.floor(Number(b?.runs)) : null;

  try {
    // 1) Submit the one-time USDC permit (relayer pays gas) so the vault has a standing allowance.
    if (b.permit && b.permit.v && b.permit.r && b.permit.s) {
      const config = savingsGaslessService.resolveConfig(chainId);
      try {
        await savingsRelayerService.submitPermit(chainId, mandate.token, {
          owner: w,
          spender: config.vaultAddress,
          value: BigInt(b.permit.value ?? '0'),
          deadline: BigInt(b.permit.deadline ?? mandate.expiry),
          v: b.permit.v,
          r: b.permit.r,
          s: b.permit.s,
        });
      } catch (permitErr) {
        // If the allowance is already sufficient (re-setup), the permit may revert on a stale nonce —
        // continue, since executeMandateDeposit will fail clearly if the allowance is actually missing.
        console.warn('[autopay] permit submit warning:', permitErr);
      }
    }

    // 2) Store the signed mandate (the runner relays each due run).
    const rule = await autopayStore.create({
      wallet: w,
      chainId,
      amountUsdc,
      cadence,
      approval: JSON.stringify(mandate),
      runsLeft,
    });
    res.json({ rule });
  } catch (error) {
    console.error('[autopay/create]', error);
    res.status(500).json({ error: 'Failed to create autopay rule' });
  }
});

// POST /api/autopay/:wallet/:id/run — execute one deposit immediately (verification / "run now").
router.post('/:wallet/:id/run', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  if (!isAutopayExecutorConfigured()) {
    res.status(503).json({ error: 'Autopay executor not configured (ZERODEV_PROJECT_ID)' });
    return;
  }
  try {
    const rule = await autopayStore.getForRun(w, String(req.params.id));
    if (!rule) {
      res.status(404).json({ error: 'Autopay rule not found' });
      return;
    }
    const result = await executeAutopayRule(rule);
    if (!result.ok) {
      res.status(400).json({ error: result.error || 'Autopay run failed' });
      return;
    }
    res.json({ ok: true, txHash: result.txHash });
  } catch (error) {
    console.error('[autopay/run]', error);
    res.status(500).json({ error: 'Failed to run autopay rule' });
  }
});

// DELETE /api/autopay/:wallet/:id
router.delete('/:wallet/:id', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  try {
    const ok = await autopayStore.cancel(w, String(req.params.id));
    if (!ok) {
      res.status(404).json({ error: 'Autopay rule not found' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('[autopay/cancel]', error);
    res.status(500).json({ error: 'Failed to cancel autopay rule' });
  }
});

export default router;
