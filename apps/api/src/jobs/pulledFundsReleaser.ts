import { pulledFundsStore } from '../services/lithic/pulledFundsStore.js';
import { refreshSnapshotsFor } from '../services/lithic/snapshotService.js';

/*
 * Releasing pulled funds once their return window closes — spec step 5.
 *
 * Without this, money pulled from an outside bank would stay out of collateral forever: the window
 * passing is a fact about the clock, and nothing else in the system notices the clock. A member
 * whose limit never rose after their deposit cleared would be declined for money they demonstrably
 * have.
 *
 * Hourly is right for a boundary measured in days. Anything faster is polling for a date, and the
 * job rewrites snapshots as a consequence, which is not free.
 */

const INTERVAL_MS = 60 * 60 * 1000;

async function tick(): Promise<void> {
  let wallets: string[];
  try {
    wallets = await pulledFundsStore.clearElapsed();
  } catch (error) {
    console.error('[pulled-funds] failed to release elapsed holds:', error);
    return;
  }
  if (wallets.length === 0) return;

  console.log(`[pulled-funds] released holds for ${wallets.length} member(s)`);

  // A limit that rises without the snapshot noticing is the member still being declined, so the
  // release is only half the job.
  for (const wallet of wallets) {
    await refreshSnapshotsFor(wallet);
  }
}

export async function startPulledFundsReleaser(): Promise<void> {
  if (!pulledFundsStore.isConfigured()) {
    console.log('[pulled-funds] releaser disabled (needs the Pay DB)');
    return;
  }
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  void tick();
  console.log('[pulled-funds] releaser started (1h interval)');
}
