import { merchantDb } from '../config/merchantDb.js';
import { checkPendingDomains } from '../services/merchant/rewards/domains.js';
import { birthdayRewards, expirePoints } from '../services/merchant/rewards/ledger.js';
import { vercelDomainsFromEnv } from '../services/merchant/rewards/vercel.js';

/*
 * Rewards' two schedules: points expiring from the last visit (looked at every six hours, so a
 * restart never skips a day), and birthday rewards on the first of each month (UTC). Both are keyed
 * in the ledger, so running twice writes once.
 */

const EVERY_MS = 6 * 60 * 60_000;
let running = false;

export async function runRewardsJobs(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = await merchantDb();
    if (!db) return;
    const expired = await expirePoints(db, now);
    const birthdays = now.getUTCDate() === 1 ? await birthdayRewards(db, now) : 0;
    if (expired || birthdays) console.log(`[rewards] expired ${expired} points, ${birthdays} birthday rewards`);
  } catch (error) {
    console.error('[rewards] jobs failed:', (error as Error)?.message);
  } finally {
    running = false;
  }
}

/** Own domains waiting on their DNS record, looked at every 10 minutes (Phase 7). */
const DOMAINS_MS = 10 * 60_000;
let checking = false;
export async function runDomainChecks(now = new Date()): Promise<void> {
  const vercel = vercelDomainsFromEnv();
  if (checking || !vercel) return;
  checking = true;
  try {
    const db = await merchantDb();
    if (!db) return;
    const live = await checkPendingDomains(db, vercel, now);
    if (live) console.log(`[rewards] ${live} own domain(s) verified`);
  } catch (error) {
    console.error('[rewards] domain checks failed:', (error as Error)?.message);
  } finally {
    checking = false;
  }
}

export function startRewardsJobs(): void {
  setInterval(() => void runRewardsJobs(), EVERY_MS).unref?.();
  setInterval(() => void runDomainChecks(), DOMAINS_MS).unref?.();
  console.log('[rewards] jobs started (points every 6h, own domains every 10 min)');
}
