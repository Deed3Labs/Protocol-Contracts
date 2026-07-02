import { Router, type Request, type Response } from 'express';
import { requestStore } from '../services/requestStore.js';
import { notificationStore } from '../services/notificationStore.js';

/*
 * Money requests, under requireAuth. Creating a request notifies the target wallet ("X requested $Y").
 * The requester is taken from the authed session, not the body.
 */
const router = Router();

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// POST /api/requests { toWallet, amount, note?, fromName? }
router.post('/', async (req: Request, res: Response) => {
  const fromWallet = req.auth?.walletAddress?.trim().toLowerCase();
  if (!fromWallet) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { toWallet, amount, note, fromName } = (req.body ?? {}) as {
    toWallet?: string;
    amount?: number;
    note?: string;
    fromName?: string;
  };
  const amt = Number(amount);
  if (!toWallet || !/^0x[a-fA-F0-9]{40}$/.test(toWallet) || !Number.isFinite(amt) || amt <= 0) {
    res.status(400).json({ error: 'Invalid request', message: 'toWallet and a positive amount are required' });
    return;
  }

  const created = await requestStore.create({
    fromWallet,
    fromName: fromName?.trim() || null,
    toWallet,
    amountUsd: amt,
    note: note?.trim() || null,
  });

  await notificationStore
    .emit({
      wallet: toWallet,
      kind: 'request',
      title: 'Payment request',
      body: `${fromName?.trim() || 'Someone'} requested ${fmt(amt)}${note?.trim() ? ` · ${note.trim()}` : ''}`,
      data: { requestId: created?.id ?? null, amount: amt, from: fromWallet, href: '/pay' },
      dedupeKey: `request:${created?.id ?? `${fromWallet}-${Date.now()}`}`,
    })
    .catch(() => {});

  res.json({ ok: true, id: created?.id ?? null });
});

export default router;
