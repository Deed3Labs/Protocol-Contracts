import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { portfolioHistoryStore } from '../services/portfolioHistoryStore.js';
import { backfill, snapshotToday } from '../services/portfolioSnapshotService.js';

/*
 * GET /api/portfolio/history?walletAddress=&range=
 * Returns daily portfolio-value points (on-chain stablecoins + Plaid bank). Auth-protected
 * (mounted behind requireAuth; wallet must match the session). First request for a wallet backfills
 * its history from transaction flows; later requests refresh today's point. The daily cron keeps
 * tracked wallets fresh.
 */
const router = Router();

const DAY = 86_400_000;
function sinceISO(range: string): string {
  const now = Date.now();
  if (range === 'YTD') {
    const start = Date.UTC(new Date().getUTCFullYear(), 0, 1);
    return new Date(start).toISOString().slice(0, 10);
  }
  const days: Record<string, number> = { '1D': 1, '1W': 7, '1M': 31, '3M': 93, '6M': 186, '1Y': 366, All: 1095 };
  return new Date(now - (days[range] ?? 31) * DAY).toISOString().slice(0, 10);
}

router.get('/history', async (req: Request, res: Response) => {
  const wallet = String(req.query.walletAddress || '');
  const range = String(req.query.range || '1M');
  if (!requireWalletMatch(req, res, wallet)) return; // sends 400/403 on mismatch

  if (!portfolioHistoryStore.isConfigured()) {
    res.json({ points: [], configured: false });
    return;
  }
  try {
    // Bump VALUATION_VERSION whenever the snapshot valuation logic changes — stale history is then
    // purged + re-backfilled once with the corrected values (keeps the chart in sync with the cards).
    const VALUATION_VERSION = 2;
    const fresh = !(await portfolioHistoryStore.hasAny(wallet));
    const stale = (await portfolioHistoryStore.getBackfillVersion(wallet)) < VALUATION_VERSION;
    if (fresh || stale) {
      if (stale && !fresh) await portfolioHistoryStore.purge(wallet);
      await backfill(wallet);
      await portfolioHistoryStore.setBackfillVersion(wallet, VALUATION_VERSION);
    } else {
      await snapshotToday(wallet).catch(() => {});
    }
    const points = await portfolioHistoryStore.getRange(wallet, sinceISO(range));
    res.json({ points, configured: true });
  } catch (e) {
    console.error('[portfolio/history]', e);
    res.status(500).json({ error: 'Failed to load portfolio history' });
  }
});

export default router;
