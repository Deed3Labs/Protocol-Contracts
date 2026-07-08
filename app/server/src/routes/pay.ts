import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { payLedgerStore, type BillerType, type EarnSource } from '../services/payLedgerStore.js';
import { getPlaidClient } from './plaid.js';
import { plaidTokenStore } from '../services/plaidTokenStore.js';
import { payBillerViaUsdc } from '../services/billerPayoutService.js';

/*
 * Clear Pay endpoints — billers (manual + Plaid-detected), payments, and the equity summary.
 * Wallet-scoped (requireWalletMatch), mounted under requireAuth. See services/payLedgerStore.ts.
 */
const router = Router();

const VALID_TYPES = new Set<BillerType>(['rent', 'utility', 'subscription', 'card', 'phone', 'other']);
const wallet = (req: Request) => String(req.params.wallet || '').toLowerCase();

/** Normalize a user-supplied portal URL to a safe http(s) link, or null. */
function cleanUrl(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Credit environment from the request origin: the live app earns mainnet credits, the demo testnet. */
const networkFromOrigin = (req: Request): 'mainnet' | 'testnet' =>
  String(req.headers.origin || req.headers.referer || '').includes('app.useclear.org') ? 'mainnet' : 'testnet';

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
    res.json(await payLedgerStore.getSummary(w, networkFromOrigin(req)));
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

// GET /api/pay/:wallet/billers/:id/payments — a biller's payment history (bill detail view)
router.get('/:wallet/billers/:id/payments', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  try {
    res.json({ payments: await payLedgerStore.listBillerPayments(w, String(req.params.id)) });
  } catch (error) {
    console.error('[pay/biller payments]', error);
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

// POST /api/pay/:wallet/billers  { name, payee?, type, defaultAmount, dueDay }
router.post('/:wallet/billers', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  const b = req.body as { name?: string; payee?: string; type?: string; defaultAmount?: number; dueDay?: number; portalUrl?: string; address?: string };
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
      portalUrl: cleanUrl(b.portalUrl),
      address: b.address ? String(b.address).slice(0, 300) : null,
    });
    res.json({ biller });
  } catch (error) {
    console.error('[pay/billers POST]', error);
    res.status(500).json({ error: 'Failed to add biller' });
  }
});

// PUT /api/pay/:wallet/billers/:id  { name, payee?, type, defaultAmount, dueDay }  (manual billers only)
router.put('/:wallet/billers/:id', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  const b = req.body as { name?: string; payee?: string; type?: string; defaultAmount?: number; dueDay?: number; portalUrl?: string; address?: string };
  if (!b?.name || !b?.type || !VALID_TYPES.has(b.type as BillerType)) {
    res.status(400).json({ error: 'name and valid type are required' });
    return;
  }
  try {
    const biller = await payLedgerStore.updateBiller(w, String(req.params.id), {
      name: String(b.name).slice(0, 200),
      payee: b.payee ? String(b.payee).slice(0, 200) : null,
      type: b.type as BillerType,
      defaultAmount: Number(b.defaultAmount) || 0,
      dueDay: b.dueDay == null ? null : Math.min(Math.max(Math.round(Number(b.dueDay)), 1), 31),
      portalUrl: cleanUrl(b.portalUrl),
      address: b.address ? String(b.address).slice(0, 300) : null,
    });
    if (!biller) {
      res.status(404).json({ error: 'Biller not found or not editable (auto-detected billers are read-only)' });
      return;
    }
    res.json({ biller });
  } catch (error) {
    console.error('[pay/billers PUT]', error);
    res.status(500).json({ error: 'Failed to update biller' });
  }
});

// PATCH /api/pay/:wallet/billers/:id/reminders  { enabled }  — works for any biller
router.patch('/:wallet/billers/:id/reminders', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  try {
    const biller = await payLedgerStore.setBillerReminders(w, String(req.params.id), Boolean((req.body as { enabled?: boolean })?.enabled));
    if (!biller) { res.status(404).json({ error: 'Biller not found' }); return; }
    res.json({ biller });
  } catch (error) {
    console.error('[pay/billers reminders]', error);
    res.status(500).json({ error: 'Failed to update reminders' });
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
      network: networkFromOrigin(req),
    });
    res.json(result);
  } catch (error) {
    console.error('[pay/payments]', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

// POST /api/pay/:wallet/reconcile
// Detects on-time recurring-bill payments from Plaid (each stream's last_date) and accrues credits
// for any not already recorded this period (idempotent per biller+period). Returns the fresh summary.
router.post('/:wallet/reconcile', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;

  const client = getPlaidClient();
  if (!client || !plaidTokenStore.isConfigured()) {
    res.json(await payLedgerStore.getSummary(w, networkFromOrigin(req))); // nothing to detect; return current state
    return;
  }

  try {
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth(); // 0-based
    const billers = await payLedgerStore.listBillers(w);
    const byStream = new Map(billers.filter((b) => b.plaidStreamId).map((b) => [b.plaidStreamId as string, b]));
    if (byStream.size > 0) {
      const items = await plaidTokenStore.getItems(w);
      for (const item of items) {
        let resp;
        try {
          resp = await client.transactionsRecurringGet({ access_token: item.access_token });
        } catch {
          continue; // skip an item Plaid can't read right now
        }
        for (const s of resp.data.outflow_streams ?? []) {
          if (s.is_active === false || !s.last_date) continue;
          const [ly, lm, ld] = s.last_date.split('-').map(Number);
          if (ly !== curY || lm - 1 !== curM) continue; // only the current period
          const biller = byStream.get(s.stream_id);
          if (!biller) continue; // need a biller_id for idempotency
          const dueDay = biller.dueDay ?? ld;
          const amount = s.last_amount?.amount != null ? Math.abs(Number(s.last_amount.amount)) : biller.defaultAmount;
          await payLedgerStore.recordPayment({
            wallet: w,
            billerId: biller.id,
            name: s.merchant_name || s.description || biller.name,
            type: biller.type,
            amount,
            dueDate: new Date(ly, lm - 1, dueDay).toISOString().slice(0, 10),
            period: `${ly}-${String(lm).padStart(2, '0')}`,
            source: 'detected' as EarnSource,
            paidAt: new Date(ly, lm - 1, ld),
            network: networkFromOrigin(req),
          });
        }
      }
    }
    res.json(await payLedgerStore.getSummary(w, networkFromOrigin(req)));
  } catch (error) {
    console.error('[pay/reconcile]', error);
    res.json(await payLedgerStore.getSummary(w, networkFromOrigin(req))); // detection is best-effort
  }
});

// POST /api/pay/:wallet/billers/:id/payout  { accountNumber, routingNumber, bankName? }  (ACH destination)
router.post('/:wallet/billers/:id/payout', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  const b = req.body as { accountNumber?: string; routingNumber?: string; bankName?: string };
  const account = String(b?.accountNumber ?? '').replace(/\s/g, '');
  const routing = String(b?.routingNumber ?? '').replace(/\s/g, '');
  if (!/^\d{4,17}$/.test(account) || !/^\d{9}$/.test(routing)) {
    res.status(400).json({ error: 'A valid account number and 9-digit routing number are required' });
    return;
  }
  try {
    const biller = await payLedgerStore.setBillerPayout(w, String(req.params.id), {
      accountNumber: account,
      routingNumber: routing,
      bankName: b.bankName ? String(b.bankName).slice(0, 120) : null,
    });
    if (!biller) {
      res.status(404).json({ error: 'Biller not found' });
      return;
    }
    res.json({ biller });
  } catch (error) {
    console.error('[pay/billers payout]', error);
    res.status(500).json({ error: 'Failed to save payout details' });
  }
});

// POST /api/pay/:wallet/pay  { billerId, amount, source, email }  (real ACH bill pay; USDC funding for now)
router.post('/:wallet/pay', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  const b = req.body as { billerId?: string; amount?: number; source?: string; email?: string };
  const amount = Number(b?.amount);
  if (!b?.billerId || !(amount > 0)) {
    res.status(400).json({ error: 'billerId and a positive amount are required' });
    return;
  }
  if ((b?.source ?? 'usdc') === 'bank') {
    res.status(501).json({ error: 'Bank funding coming soon', message: 'Bank-funded bill pay isn’t available yet — pay from Cash (USDC).' });
    return;
  }
  try {
    const result = await payBillerViaUsdc({
      wallet: w,
      email: String(b.email ?? '').trim().toLowerCase(),
      billerId: String(b.billerId),
      amountUsd: amount,
    });
    if (!result.success) {
      res.status(400).json({ error: 'Payout failed', message: result.reason });
      return;
    }
    // Bridge pulls the USDC on transfer creation, so record the payment now (equity credits use the
    // 30-day vesting window as the settlement buffer).
    const biller = (await payLedgerStore.listBillers(w)).find((x) => x.id === b.billerId);
    if (biller) {
      const now = new Date();
      await payLedgerStore.recordPayment({
        wallet: w,
        billerId: biller.id,
        name: biller.name,
        type: biller.type,
        amount,
        dueDate: biller.dueDay ? new Date(now.getFullYear(), now.getMonth(), biller.dueDay).toISOString().slice(0, 10) : null,
        period: now.toISOString().slice(0, 7),
        source: 'in_app',
        txRef: result.providerReference ?? null,
        network: networkFromOrigin(req),
      });
    }
    res.json({ success: true, providerReference: result.providerReference, status: result.status });
  } catch (error) {
    console.error('[pay/pay]', error);
    res.status(500).json({ error: 'Failed to execute payout' });
  }
});

export default router;
