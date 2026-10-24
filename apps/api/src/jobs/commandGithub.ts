import { merchantDb } from '../config/merchantDb.js';
import { codeConfig, liveGithub, pollOnce, recordCodeError } from '../services/command/github.js';

/*
 * The Command Center's GitHub poller, on a schedule (docs/command-center-plan.md, Phase 5c): every
 * 5 minutes by default (COMMAND_GITHUB_MINUTES), and a catch-up when someone opens Contracts, at
 * most once a minute. A quiet run is one request, answered 304 with the last ETag, which costs
 * nothing against GITHUB_TOKEN's rate limit.
 *
 * GITHUB_TOKEN: a fine-grained token, read-only, Contents on Deed3Labs/Protocol-Contracts. Without
 * one it still runs (the repository is public) at 60 requests an hour.
 *
 * Off with COMMAND_GITHUB=off. Safe to run twice at once (every write is idempotent).
 */

const minutes = () => {
  const m = Number(process.env.COMMAND_GITHUB_MINUTES);
  return Number.isFinite(m) && m > 0 ? m : 5;
};
const CATCH_UP_MS = 60_000;

let running = false;
let lastRun = 0;

async function tick(reason: string): Promise<void> {
  if (running) return;
  running = true;
  lastRun = Date.now();
  const c = codeConfig();
  const db = await merchantDb().catch(() => null);
  try {
    if (!db) return;
    const r = await pollOnce(db, liveGithub(), c);
    if (r.added || r.filled) console.log(`[github] ${reason}: +${r.added} commits, files for ${r.filled}${r.waiting ? `, ${r.waiting} still to read` : ''}`);
  } catch (error) {
    console.error('[github] run failed:', (error as Error).message);
    if (db) await recordCodeError(db, c, error).catch(() => undefined);
  } finally {
    running = false;
  }
}

/** Someone's looking at Contracts: bring the commits up to date, unless that happened in the last minute. */
export function githubCatchUp(): void {
  if (process.env.COMMAND_GITHUB === 'off' || Date.now() - lastRun < CATCH_UP_MS) return;
  void tick('catch-up');
}

export function startCommandGithub(): void {
  if (process.env.COMMAND_GITHUB === 'off') return console.log('[github] off (COMMAND_GITHUB=off)');
  setInterval(() => void tick('scheduled'), minutes() * 60_000);
  void tick('boot');
  const c = codeConfig();
  console.log(`[github] ${c.repo}@${c.branch}/${c.path} every ${minutes()} min, and on demand${process.env.GITHUB_TOKEN ? '' : ' (no GITHUB_TOKEN: 60 requests an hour)'}`);
}
