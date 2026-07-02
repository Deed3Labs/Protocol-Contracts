import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { notificationStore } from '../services/notificationStore.js';

/*
 * In-app notifications, wallet-scoped (requireWalletMatch checks the :wallet param against the authed
 * session) under requireAuth. Rows are created server-side by producers (transfers, credits, requests,
 * cron). See services/notificationStore.ts.
 */
const router = Router();
const wallet = (req: Request) => String(req.params.wallet || '').toLowerCase();
// All wallets this user controls (the :wallet param + every verified address on the session), so a
// notification scoped to any of them (primary vs smart vs linked) is still read/marked/archived here.
const wallets = (req: Request) => {
  const set = new Set<string>([wallet(req)]);
  for (const a of req.auth?.addresses ?? []) if (a) set.add(a.toLowerCase());
  return [...set].filter(Boolean);
};

// GET /api/notifications/:wallet → { notifications, unreadCount }
router.get('/:wallet', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!notificationStore.isConfigured()) {
    res.json({ notifications: [], unreadCount: 0 });
    return;
  }
  res.json(await notificationStore.list(wallets(req)));
});

// POST /api/notifications/:wallet/read-all
router.post('/:wallet/read-all', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  await notificationStore.markAllRead(wallets(req));
  res.json({ ok: true });
});

// POST /api/notifications/:wallet/test — send yourself a test notification (verifies in-app + push)
router.post('/:wallet/test', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  await notificationStore.emit({
    wallet: w,
    kind: 'system',
    title: 'Test notification 🎉',
    body: 'If you can see this, your notifications are working.',
    data: { href: '/' },
    dedupeKey: `test:${Date.now()}`,
    push: true,
  });
  res.json({ ok: true });
});

// POST /api/notifications/:wallet/subscribe — register a Web Push subscription
router.post('/:wallet/subscribe', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  const { subscription } = (req.body ?? {}) as { subscription?: { endpoint?: string } & Record<string, unknown> };
  if (!subscription?.endpoint) {
    res.status(400).json({ error: 'Missing subscription' });
    return;
  }
  await notificationStore.saveSubscription(w, subscription);
  res.json({ ok: true });
});

// POST /api/notifications/:wallet/:id/read
router.post('/:wallet/:id/read', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  await notificationStore.markRead(wallets(req), String(req.params.id));
  res.json({ ok: true });
});

// POST /api/notifications/:wallet/:id/archive
router.post('/:wallet/:id/archive', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  await notificationStore.archive(wallets(req), String(req.params.id));
  res.json({ ok: true });
});

export default router;
