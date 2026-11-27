import { merchantDb } from '../config/merchantDb.js';
import { liveFeeds } from '../services/command/feedSources.js';
import { due, feedRows, runFeed } from '../services/command/feeds.js';

/*
 * The Command Center's sandbox feeds, on a schedule (docs/command-center-plan.md, Phase 6a). A tick
 * a minute runs whichever are due: Lithic, Bridge and Stripe every 5 minutes (COMMAND_FEEDS_MINUTES),
 * Plaid once a day (COMMAND_PLAID_HOURS), and any feed asked for (Sync now, Plaid's webhook, a Stripe
 * payout landing) at the next tick.
 *
 * Off with COMMAND_FEEDS=off. Safe to run twice at once: each run only rewrites its feed's row.
 */

let running = false;
const feeds = liveFeeds();

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  const db = await merchantDb().catch(() => null);
  try {
    if (!db) return;
    for (const f of due(feeds, await feedRows(db), Date.now())) {
      const r = await runFeed(db, f);
      if (r === 'error') console.error(`[feeds] ${f.id} failed: ${(await feedRows(db)).get(f.id)?.error}`);
    }
  } catch (error) {
    console.error('[feeds] tick failed:', (error as Error).message);
  } finally {
    running = false;
  }
}

export function startCommandFeeds(): void {
  if (process.env.COMMAND_FEEDS === 'off') return console.log('[feeds] off (COMMAND_FEEDS=off)');
  setInterval(() => void tick(), 60_000);
  void tick();
  const off = feeds.map((f) => [f.id, f.off()] as const).filter(([, why]) => why);
  console.log(`[feeds] ${feeds.map((f) => f.id).join(', ')} on their schedules${off.length ? `; off: ${off.map(([id, why]) => `${id} (${why})`).join(', ')}` : ''}`);
}
