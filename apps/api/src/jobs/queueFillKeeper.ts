import { queueFillDeps, queueFillMinutes, queueFillMode, runQueueFill } from '../services/chain/queueFill.js';
import { usdOf } from '../services/chain/keeperKit.js';

/*
 * The queue keeper's clock (decision 53). See services/chain/queueFill for what it sends and when.
 *
 * Every 15 minutes by default (QUEUE_FILL_KEEPER_MINUTES): a Holder waiting in the queue is paid
 * soon after cash comes back to the vault, and a pass with an empty queue or no cash is four reads
 * and no transaction. Off unless QUEUE_FILL_KEEPER_ENABLED=1; QUEUE_FILL_KEEPER_DRY_RUN=1 simulates
 * and reports without sending. Gas: the card settler's key.
 */

async function tick(): Promise<void> {
  const deps = queueFillDeps();
  if (!deps) return;
  try {
    const run = await runQueueFill(deps);
    if (run.outcome === 'sent') console.log(`[queue-fill] filled ${run.filled} request(s), ${usdOf(run.paid ?? 0n)} paid: ${run.txHash}`);
    if (run.outcome === 'blocked' || run.outcome === 'not_due') console.log(`[queue-fill] ${run.state?.queuedShares ?? 0n} shares queued, not filled: ${run.reason}`);
  } catch (error) {
    console.error('[queue-fill] pass failed:', (error as Error)?.message);
  }
}

export function startQueueFillKeeper(): void {
  const mode = queueFillMode();
  if (mode === 'off') {
    console.log('[queue-fill] disabled (set QUEUE_FILL_KEEPER_ENABLED=1, with QUEUE_FILL_KEEPER_DRY_RUN=1 first, to fill the Yield Pool queue)');
    return;
  }
  if (!queueFillDeps()) {
    console.log('[queue-fill] disabled (needs the LendingPool address and CARD_SETTLER_PRIVATE_KEY for gas)');
    return;
  }
  const minutes = queueFillMinutes();
  setInterval(() => void tick(), minutes * 60_000).unref?.();
  void tick();
  console.log(`[queue-fill] started (every ${minutes} min${mode === 'dry_run' ? ', dry run' : ''})`);
}
