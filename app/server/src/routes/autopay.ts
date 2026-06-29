import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { autopayStore, type AutopayCadence } from '../services/autopayStore.js';

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

  const b = req.body as { chainId?: number; amountUsdc?: number; cadence?: string; approval?: string; runs?: number };
  const chainId = Number(b?.chainId);
  const amountUsdc = Number(b?.amountUsdc);
  const cadence = String(b?.cadence ?? '') as AutopayCadence;
  const approval = String(b?.approval ?? '');

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
  if (!approval || approval.length < 32) {
    res.status(400).json({ error: 'A valid session approval is required' });
    return;
  }
  const runsLeft = Number.isFinite(Number(b?.runs)) && Number(b?.runs) > 0 ? Math.floor(Number(b?.runs)) : null;

  try {
    const rule = await autopayStore.create({ wallet: w, chainId, amountUsdc, cadence, approval, runsLeft });
    res.json({ rule });
  } catch (error) {
    console.error('[autopay/create]', error);
    res.status(500).json({ error: 'Failed to create autopay rule' });
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
