import { merchantDb } from '../config/merchantDb.js';
import { findDeployBlocks, indexOnce, liveChainSource, recordError, syncInventory } from '../services/command/indexer.js';

/*
 * The Command Center's indexer, on a schedule (docs/command-center-plan.md, Phase 5a): every 5
 * minutes by default, and a catch-up when someone opens Contracts or Money, at most once a minute.
 * Each run asks only for blocks it hasn't read, all contracts in one request per page, so a quiet
 * chain costs two requests a run. The first runs backfill from the deploy blocks, a few hundred
 * pages at a time, and a run that's caught up stops early.
 *
 * Off with COMMAND_INDEXER=off. Safe to run twice at once (every write is idempotent), so a second
 * API replica only repeats work.
 */

const minutes = () => {
  const m = Number(process.env.COMMAND_INDEXER_MINUTES);
  return Number.isFinite(m) && m > 0 ? m : 5;
};
const CATCH_UP_MS = 60_000;
/** A run stops after this long even mid-backfill; the next one carries on. */
const RUN_BUDGET_MS = 4 * 60_000;

let running = false;
let lastRun = 0;
const source = liveChainSource(84532);

async function tick(reason: string): Promise<void> {
  if (running) return;
  running = true;
  lastRun = Date.now();
  const db = await merchantDb().catch(() => null);
  try {
    if (!db) return;
    await syncInventory(db);
    const found = await findDeployBlocks(db, source);
    if (found) console.log(`[indexer] deploy blocks found for ${found} contract(s)`);
    const startedAt = Date.now();
    let added = 0,
      removed = 0,
      to = 0;
    for (;;) {
      const r = await indexOnce(db, source, { maxPages: 100 });
      added += r.added;
      removed += r.removed;
      to = r.to;
      if (r.caughtUp || Date.now() - startedAt > RUN_BUDGET_MS) break;
    }
    if (added || removed) console.log(`[indexer] ${reason}: +${added}${removed ? ` −${removed} (reorged out)` : ''} events, indexed to block ${to}`);
  } catch (error) {
    console.error('[indexer] run failed:', (error as Error).message);
    if (db) await recordError(db, 84532, error).catch(() => undefined);
  } finally {
    running = false;
  }
}

/** Someone's looking at Contracts or Money: bring it up to date, unless that happened in the last minute. */
export function indexerCatchUp(): void {
  if (process.env.COMMAND_INDEXER === 'off' || Date.now() - lastRun < CATCH_UP_MS) return;
  void tick('catch-up');
}

export function startCommandIndexer(): void {
  if (process.env.COMMAND_INDEXER === 'off') return console.log('[indexer] off (COMMAND_INDEXER=off)');
  setInterval(() => void tick('scheduled'), minutes() * 60_000);
  void tick('boot');
  console.log(`[indexer] every ${minutes()} min, and on demand`);
}
