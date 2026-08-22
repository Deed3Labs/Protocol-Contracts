import { sweepStore } from '../services/sweeps/sweepStore.js';
import { advanceSweep } from '../services/sweeps/sweepService.js';

/*
 * Driving sweeps forward — spec step 7.
 *
 * The saga's states are durable, so this runner holds nothing: it picks up whatever is due, moves
 * each sweep one step, and forgets. A restart mid-sweep costs one interval, not a member's money.
 *
 * Every minute, because a member watching a sweep should see it move. The pulled-funds releaser can
 * run hourly since it waits on a date; this waits on a network call that usually takes seconds.
 *
 * It picks up almost nothing, by design. `fiat_debited` is waiting on ACH and the Bridge webhook —
 * a runner "retrying" it would push the money a second time. `ready_to_allocate` is waiting on the
 * member, and choosing for them would be the whole point missed. What is left is starting the push
 * and finishing after a mint.
 */

const INTERVAL_MS = 60 * 1000;
const BATCH = 25;

let running = false;

async function tick(): Promise<void> {
  // A slow chain call must not let two runs overlap and attempt the same step twice.
  if (running) return;
  running = true;

  try {
    const due = await sweepStore.due(BATCH);
    if (due.length === 0) return;

    let advanced = 0;
    let stalled = 0;

    for (const sweep of due) {
      const result = await advanceSweep(sweep);
      if (result.advanced) advanced += 1;
      else stalled += 1;

    }

    if (advanced || stalled) {
      console.log(`[sweeps] ${advanced} advanced, ${stalled} awaiting retry`);
    }
  } catch (error) {
    console.error('[sweeps] runner tick failed:', error);
  } finally {
    running = false;
  }
}

export async function startSweepRunner(): Promise<void> {
  if (!sweepStore.isConfigured()) {
    console.log('[sweeps] runner disabled (needs the Pay DB)');
    return;
  }
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  void tick();
  console.log('[sweeps] runner started (60s interval)');
}
