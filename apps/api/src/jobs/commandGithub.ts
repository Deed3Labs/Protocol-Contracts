import { merchantDb } from '../config/merchantDb.js';
import { codeConfig, liveGithub, pollChecks, pollOnce, pollPulls, recordCodeError, recordPullError } from '../services/command/github.js';

/*
 * The Command Center's GitHub poller, on a schedule (docs/command-center-plan.md, Phase 5c): every
 * 5 minutes by default (COMMAND_GITHUB_MINUTES), and a catch-up when someone opens Contracts, at
 * most once a minute. Each run reads the commits on every watched branch (COMMAND_GITHUB_BRANCHES,
 * `dev,main`), then the pull requests. A quiet run is one request a branch and one for the pull
 * requests, each answered 304 with the last ETag, which costs nothing against GITHUB_TOKEN's rate
 * limit; files are read only for what's new, within a budget a run.
 *
 * GITHUB_TOKEN: a fine-grained token, read-only: Contents, Pull requests and Actions (for Build's
 * Checks and Reviews) on Deed3Labs/Protocol-Contracts. Without
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
    const src = liveGithub();
    // the commits and the pull requests fail apart: one's error doesn't stop the other
    try {
      const r = await pollOnce(db, src, c);
      if (r.added || r.filled) console.log(`[github] ${reason}: +${r.added} commits, files for ${r.filled}${r.waiting ? `, ${r.waiting} still to read` : ''}`);
    } catch (error) {
      console.error('[github] commits failed:', (error as Error).message);
      await recordCodeError(db, c, error).catch(() => undefined);
    }
    try {
      const p = await pollPulls(db, src, c);
      if (p.read) console.log(`[github] ${reason}: files for ${p.read} pull requests${p.waiting ? `, ${p.waiting} still to read` : ''}`);
    } catch (error) {
      console.error('[github] pull requests failed:', (error as Error).message);
      await recordPullError(db, c, error).catch(() => undefined);
    }
    // Build's Checks and Reviews: the branch's Actions runs, each pull request's checks and reviews (migration 0070)
    try {
      const k = await pollChecks(db, src, c);
      if (k.jobsRead || k.checksRead || k.reviewsRead) console.log(`[github] ${reason}: jobs for ${k.jobsRead} runs, checks for ${k.checksRead} and reviews for ${k.reviewsRead} pull requests`);
    } catch (error) {
      console.error('[github] checks failed:', (error as Error).message);
    }
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
  console.log(`[github] ${c.repo}@${c.branches.join(',')}${c.watch ? '/' + c.watch : ''} and its pull requests every ${minutes()} min, and on demand${process.env.GITHUB_TOKEN ? '' : ' (no GITHUB_TOKEN: 60 requests an hour)'}`);
}
