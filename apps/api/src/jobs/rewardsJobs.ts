import { merchantDb } from '../config/merchantDb.js';
import { birthdayRewards, expirePoints } from '../services/merchant/rewards/ledger.js';

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

export function startRewardsJobs(): void {
  setInterval(() => void runRewardsJobs(), EVERY_MS).unref?.();
  console.log('[rewards] jobs started (every 6h)');
}
