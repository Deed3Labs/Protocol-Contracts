import { reconcileCharges } from './chargeService.js';

/*
 * The loop that ends a stuck charge's wait.
 *
 * Runs on a plain interval rather than a cron because the work is idempotent, cheap when there is
 * nothing to do (one indexed query returning no rows), and only ever touches charges in
 * `resolving` -- a set the approve path never writes to. There is no race to design around.
 *
 * Deliberately not eager. A charge is left alone for a couple of minutes first, because the
 * ordinary case is simply a transaction taking longer than usual to mine, and reconciling one that
 * was never actually stuck is work done to reach the same answer the approve call was about to
 * reach by itself.
 */
const INTERVAL_MS = Number(process.env.CHARGE_RECONCILE_INTERVAL_MS || 60_000);
const MIN_AGE_SECONDS = Number(process.env.CHARGE_RECONCILE_MIN_AGE_SECONDS || 120);

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runChargeReconcileOnce(): Promise<void> {
  // Overlap guard: a slow RPC must not have two passes walking the same rows. They would not
  // corrupt anything -- `finish` only closes a row still resolving -- but it is wasted calls
  // against a provider that is already struggling.
  if (running) return;
  running = true;
  try {
    const summary = await reconcileCharges(MIN_AGE_SECONDS);
    if (summary.checked > 0) {
      console.log(
        `[charge] reconciled ${summary.checked}: ${summary.approved} approved, ` +
          `${summary.released} released, ${summary.stillPending} still pending, ${summary.unknown} unresolved`,
      );
    }
  } catch (error) {
    console.error('[charge] reconcile pass failed', error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

export function startChargeReconciler(): void {
  if (timer) return;
  // `unref` so this never holds the process open on shutdown. A pass interrupted mid-flight costs
  // nothing: the next one asks the chain the same question and gets the same answer.
  timer = setInterval(() => void runChargeReconcileOnce(), INTERVAL_MS);
  timer.unref?.();
  // One pass at boot, because the most likely reason a charge is stuck is that this process died.
  void runChargeReconcileOnce();
}

export function stopChargeReconciler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
