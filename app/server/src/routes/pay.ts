import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { payLedgerStore, type BillerType, type EarnSource } from '../services/payLedgerStore.js';

/*
 * Clear Pay endpoints — billers (manual + Plaid-detected), payments, and the equity summary.
 * Wallet-scoped (requireWalletMatch), mounted under requireAuth. See services/payLedgerStore.ts.
 */
const router = Router();

const VALID_TYPES = new Set<BillerType>(['rent', 'utility', 'card', 'phone', 'other']);
const wallet = (req: Request) => String(req.params.wallet || '').toLowerCase();

function ensureReady(res: Response): boolean {
  if (!payLedgerStore.isConfigured()) {
    res.status(503).json({ error: 'Ledger not configured' });
    return false;
  }
  return true;
}

// GET /api/pay/:wallet/summary
router.get('/:wallet/summary', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  try {
    res.json(await payLedgerStore.getSummary(w));
  } catch (error) {
    console.error('[pay/summary]', error);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// GET /api/pay/:wallet/billers
router.get('/:wallet/billers', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  try {
    res.json({ billers: await payLedgerStore.listBillers(w) });
  } catch (error) {
    console.error('[pay/billers]', error);
    res.status(500).json({ error: 'Failed to load billers' });
  }
});

// POST /api/pay/:wallet/billers  { name, payee?, type, defaultAmount, dueDay }
router.post('/:wallet/billers', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  const b = req.body as { name?: string; payee?: string; type?: string; defaultAmount?: number; dueDay?: number };
  if (!b?.name || !b?.type || !VALID_TYPES.has(b.type as BillerType)) {
    res.status(400).json({ error: 'name and valid type are required' });
    return;
  }
  try {
    const biller = await payLedgerStore.addBiller(w, {
      name: String(b.name).slice(0, 200),
      payee: b.payee ? String(b.payee).slice(0, 200) : null,
      type: b.type as BillerType,
      defaultAmount: Number(b.defaultAmount) || 0,
      dueDay: b.dueDay == null ? null : Math.min(Math.max(Math.round(Number(b.dueDay)), 1), 31),
    });
    res.json({ biller });
  } catch (error) {
    console.error('[pay/billers POST]', error);
    res.status(500).json({ error: 'Failed to add biller' });
  }
});

// DELETE /api/pay/:wallet/billers/:id
router.delete('/:wallet/billers/:id', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  try {
    await payLedgerStore.archiveBiller(w, String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove biller' });
  }
});

// POST /api/pay/:wallet/billers/plaid  { streams: [{ streamId, name, amount, dueDay, type }] }
router.post('/:wallet/billers/plaid', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  const streams = Array.isArray((req.body as { streams?: unknown })?.streams) ? (req.body as { streams: unknown[] }).streams : [];
  try {
    await payLedgerStore.upsertPlaidBillers(
      w,
      streams
        .map((s) => s as { streamId?: string; name?: string; amount?: number; dueDay?: number; type?: string })
        .filter((s) => s.streamId && s.name)
        .map((s) => ({
          streamId: String(s.streamId),
          name: String(s.name).slice(0, 200),
          amount: Number(s.amount) || 0,
          dueDay: Math.min(Math.max(Math.round(Number(s.dueDay) || 1), 1), 31),
          type: (VALID_TYPES.has(s.type as BillerType) ? s.type : 'other') as BillerType,
        })),
    );
    res.json({ billers: await payLedgerStore.listBillers(w) });
  } catch (error) {
    console.error('[pay/billers/plaid]', error);
    res.status(500).json({ error: 'Failed to sync billers' });
  }
});

// POST /api/pay/:wallet/payments  { billerId?, name, type, amount, dueDate?, period, source?, txRef? }
router.post('/:wallet/payments', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  const p = req.body as {
    billerId?: string; name?: string; type?: string; amount?: number; dueDate?: string; period?: string; source?: string; txRef?: string;
  };
  if (!p?.name || !p?.type || !VALID_TYPES.has(p.type as BillerType) || !p?.period || !(Number(p.amount) > 0)) {
    res.status(400).json({ error: 'name, valid type, amount and period are required' });
    return;
  }
  try {
    const result = await payLedgerStore.recordPayment({
      wallet: w,
      billerId: p.billerId ? String(p.billerId) : null,
      name: String(p.name).slice(0, 200),
      type: p.type as BillerType,
      amount: Number(p.amount),
      dueDate: p.dueDate ? String(p.dueDate) : null,
      period: String(p.period).slice(0, 7),
      source: (p.source === 'detected' ? 'detected' : 'in_app') as EarnSource,
      txRef: p.txRef ? String(p.txRef) : null,
    });
    res.json(result);
  } catch (error) {
    console.error('[pay/payments]', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

export default router;
