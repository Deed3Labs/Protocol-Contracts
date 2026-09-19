import { sessionLock } from '../services/session/sessionLock.js';

/*
 * Housekeeping for the server-side lock (services/session/sessionLock).
 *
 *   hourly  drop sessions idle an hour from this process's memory, so it does not grow until the
 *           next deploy. They are read back from the table if seen again.
 *   daily   delete sessions neither used nor making any request for 30 days, so the table does not
 *           grow forever. A device left open is still making requests, so its session stays -- and
 *           stays locked.
 *
 * A session with no row is treated as new (open), which is why nothing still alive is deleted.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function deleteStale(): Promise<void> {
  try {
    const removed = await sessionLock.deleteStale();
    if (removed) console.log(`[session-cleanup] deleted ${removed} session(s) quiet for 30 days`);
  } catch (error) {
    console.error('[session-cleanup] could not delete stale sessions:', (error as Error)?.message);
  }
}

export function startSessionCleanup(): void {
  if (!sessionLock.available()) {
    console.log('[session-cleanup] disabled (needs the Pay DB)');
    return;
  }
  setInterval(() => sessionLock.forgetIdle(), HOUR_MS).unref?.();
  setInterval(() => void deleteStale(), DAY_MS).unref?.();
  void deleteStale();
  console.log('[session-cleanup] started (memory hourly, table daily)');
}
