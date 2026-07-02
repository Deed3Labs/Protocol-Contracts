import { Router, type Request, type Response } from 'express';
import { requestStore } from '../services/requestStore.js';
import { notificationStore } from '../services/notificationStore.js';
import { contactsStore } from '../services/contactsStore.js';
import { memberStore } from '../services/memberStore.js';

/*
 * Money requests, under requireAuth. Hardened against spoofing:
 *  - the requester (from_wallet) comes from the authed session, never the body;
 *  - the recipient is resolved server-side from their email/phone via the member directory, so the
 *    caller can't target an arbitrary wallet (only a discoverable Clear member);
 *  - the sender's display name is read from their own member profile, not client-supplied.
 * Creating a request notifies the recipient ("<name> requested $Y").
 */
const router = Router();
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function senderDisplayName(req: Request): Promise<string> {
  try {
    const authSubject = await memberStore.resolveCanonicalAuthSubject({
      authSubject: req.auth?.profileUuid ?? req.auth?.walletAddress?.toLowerCase() ?? null,
      profileUuid: req.auth?.profileUuid ?? null,
      walletAddress: req.auth?.walletAddress ?? null,
      walletAddresses: req.auth?.addresses ?? null,
      email: req.auth?.email ?? null,
      phone: req.auth?.phone ?? null,
    });
    if (!authSubject) return 'Someone';
    const profile = await memberStore.getProfileByAuthSubject(authSubject);
    return profile?.publicProfile.displayName?.trim() || profile?.publicProfile.username?.trim() || 'Someone';
  } catch {
    return 'Someone';
  }
}

// POST /api/requests { recipientEmail?, recipientPhone?, amount, note? }
router.post('/', async (req: Request, res: Response) => {
  const fromWallet = req.auth?.walletAddress?.trim().toLowerCase();
  if (!fromWallet) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { recipientEmail, recipientPhone, amount, note } = (req.body ?? {}) as {
    recipientEmail?: string;
    recipientPhone?: string;
    amount?: number;
    note?: string;
  };
  const amt = Number(amount);
  if ((!recipientEmail && !recipientPhone) || !Number.isFinite(amt) || amt <= 0) {
    res.status(400).json({ error: 'Invalid request', message: 'A recipient email/phone and a positive amount are required.' });
    return;
  }

  // Resolve the recipient to a Clear member — the caller can't target an arbitrary wallet.
  const match = await contactsStore.lookupWallet(recipientEmail || undefined, recipientPhone || undefined);
  if (!match?.wallet) {
    res.status(404).json({ error: 'Recipient not found', message: "That person isn't a Clear member (or isn't discoverable)." });
    return;
  }
  if (match.wallet.toLowerCase() === fromWallet) {
    res.status(400).json({ error: 'Invalid recipient', message: "You can't request money from yourself." });
    return;
  }

  const fromName = await senderDisplayName(req);
  const created = await requestStore.create({
    fromWallet,
    fromName,
    toWallet: match.wallet,
    amountUsd: amt,
    note: note?.trim() || null,
  });

  await notificationStore
    .emit({
      wallet: match.wallet,
      kind: 'request',
      title: 'Payment request',
      body: `${fromName} requested ${fmt(amt)}${note?.trim() ? ` · ${note.trim()}` : ''}`,
      data: { requestId: created?.id ?? null, amount: amt, from: fromWallet, href: '/pay' },
      dedupeKey: `request:${created?.id ?? `${fromWallet}-${Date.now()}`}`,
    })
    .catch(() => {});

  res.json({ ok: true, id: created?.id ?? null });
});

export default router;
