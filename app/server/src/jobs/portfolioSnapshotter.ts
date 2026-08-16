import { snapshotAllWallets } from '../services/portfolioSnapshotService.js';
import { portfolioHistoryStore } from '../services/portfolioHistoryStore.js';

/*
 * Daily portfolio-value snapshot job. Refreshes today's total for every wallet already tracked
 * (wallets get registered the first time they hit /api/portfolio/history, which backfills history).
 *
 * OFF BY DEFAULT, and the reason is worth stating rather than discovering.
 *
 * This job costs twice a day, every day: a balance fetch per wallet across chains, and a row per
 * wallet in `portfolio_history` — a table with no retention policy, so it grows as wallets times
 * days, forever. That was a fair trade when something displayed it. Today the only reader is
 * BalanceAnalyticsChart, which is used by exactly one page, and that page is archived.
 *
 * So it was paying storage and compute daily to draw a chart nobody can open. Set
 * PORTFOLIO_SNAPSHOTS=on to bring it back when a live surface needs the history again — the route
 * still serves what is already stored, and backfills from transaction flows for a wallet it has
 * never seen, so turning it off does not break the endpoint.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function enabled(): boolean {
  return (process.env.PORTFOLIO_SNAPSHOTS || '').trim().toLowerCase() === 'on';
}

export async function startPortfolioSnapshotter(): Promise<void> {
  if (!enabled()) {
    console.log('ℹ️  Portfolio snapshotter off (set PORTFOLIO_SNAPSHOTS=on to enable)');
    return;
  }
  if (!portfolioHistoryStore.isConfigured()) {
    console.log('ℹ️  Portfolio snapshotter disabled (no DATABASE_URL)');
    return;
  }
  const run = () => snapshotAllWallets().catch((e) => console.error('⚠️ Portfolio snapshot run failed:', e));
  setTimeout(run, 60_000); // first run shortly after boot
  setInterval(run, DAY_MS);
  console.log('✅ Portfolio snapshotter started (daily)');
}
