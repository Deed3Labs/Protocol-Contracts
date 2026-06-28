import { snapshotAllWallets } from '../services/portfolioSnapshotService.js';
import { portfolioHistoryStore } from '../services/portfolioHistoryStore.js';

/*
 * Daily portfolio-value snapshot job. Refreshes today's total for every wallet already tracked
 * (wallets get registered the first time they hit /api/portfolio/history, which backfills history).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export async function startPortfolioSnapshotter(): Promise<void> {
  if (!portfolioHistoryStore.isConfigured()) {
    console.log('ℹ️  Portfolio snapshotter disabled (no DATABASE_URL)');
    return;
  }
  const run = () => snapshotAllWallets().catch((e) => console.error('⚠️ Portfolio snapshot run failed:', e));
  setTimeout(run, 60_000); // first run shortly after boot
  setInterval(run, DAY_MS);
  console.log('✅ Portfolio snapshotter started (daily)');
}
