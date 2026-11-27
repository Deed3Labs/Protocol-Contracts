import { reconcile } from '../services/reconciliation/reconcileService.js';
import { getPayPool } from '../config/postgres.js';

/*
 * Running the four invariants on a schedule — spec §3.
 *
 * "Reconcile on a schedule, not per transaction." Per-transaction reconciliation would put a
 * consistency check on the authorization path, which has a three-second budget and must never block
 * on reading a chain.
 *
 * It alerts and never corrects. Drift is a signal that something upstream is wrong, and the value
 * of the signal is that a person looks at it while the evidence is still there. A job that quietly
 * repaired the numbers would erase exactly the trail needed to find the cause.
 *
 * Hourly. Frequent enough that drift is caught the same day, rare enough that it never competes
 * with real work — and every invariant it checks moves on the scale of hours or days.
 */

const INTERVAL_MS = 60 * 60 * 1000;

let running = false;

function money(cents: number | null): string {
  if (cents === null) return 'unknown';
  return `$${(cents / 100).toFixed(2)}`;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const report = await reconcile();

    for (const result of report.results) {
      if (result.status === 'drift') {
        // Loud, and with both figures: someone reading this at 2am needs to know which side moved.
        console.error(
          `[reconcile] DRIFT on ${result.label} — books say ${money(result.expectedCents)},` +
            ` observed ${money(result.actualCents)}, off by ${money(result.driftCents)}.` +
            ` ${result.detail}`,
        );
      } else if (result.status === 'unavailable') {
        // Not an alarm, but never silent either. An invariant nobody can check is a gap in coverage
        // and should be visible as one rather than blending into a passing run.
        console.warn(`[reconcile] could not check ${result.label} — ${result.detail}`);
      }
    }

    if (report.healthy) {
      console.log('[reconcile] all four invariants hold');
    } else {
      console.warn(
        `[reconcile] ${report.driftCount} drifted, ${report.unavailableCount} could not be checked`,
      );
    }
  } catch (error) {
    console.error('[reconcile] run failed:', error);
  } finally {
    running = false;
  }
}

export async function startReconciler(): Promise<void> {
  if (!getPayPool()) {
    console.log('[reconcile] disabled (needs the Pay DB)');
    return;
  }
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  void tick();
  console.log('[reconcile] started (1h interval)');
}
