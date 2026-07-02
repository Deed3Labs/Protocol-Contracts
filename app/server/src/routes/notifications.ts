import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { notificationStore } from '../services/notificationStore.js';

/*
 * In-app notifications, wallet-scoped (requireWalletMatch) under requireAuth. Read model only — rows are
 * created server-side by producers (transfers, equity credits, cron). See services/notificationStore.ts.
 */
const router = Router();
const wallet = (req: Request) => String(req.params.wallet || '').toLowerCase();

function ensureReady(res: Response): boolean {
  if (!notificationStore.isConfigured()) {
    res.json({ notifications: [], unreadCount: 0 });
    return false;
  }
  return true;
}

// GET /api/notifications/:wallet → { notifications, unreadCount }
router.get('/:wallet', requireWalletMatch, async (req, res) => {
  if (!ensureReady(res)) return;
  const data = await notificationStore.list(wallet(req));
  res.json(data);
});

// POST /api/notifications/:wallet/read-all
router.post('/:wallet/read-all', requireWalletMatch, async (req, res) => {
  await notificationStore.markAllRead(wallet(req));
  res.json({ ok: true });
});

// POST /api/notifications/:wallet/:id/read
router.post('/:wallet/:id/read', requireWalletMatch, async (req, res) => {
  await notificationStore.markRead(wallet(req), String(req.params.id));
  res.json({ ok: true });
});

// POST /api/notifications/:wallet/:id/archive
router.post('/:wallet/:id/archive', requireWalletMatch, async (req, res) => {
  await notificationStore.archive(wallet(req), String(req.params.id));
  res.json({ ok: true });
});

export default router;
