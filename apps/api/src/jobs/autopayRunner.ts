import { autopayStore } from '../services/autopayStore.js';
import { executeAutopayRule, isAutopayExecutorConfigured } from '../services/autopayService.js';

/*
 * Autopay runner — polls for due savings-deposit rules and executes them with their stored ZeroDev
 * session (no user signing, sponsored gas). On success it awards equity credits from the verified
 * on-chain amount; on failure it records the error and the store pushes the next run out for retry.
 * Disabled unless ZERODEV_PROJECT_ID + the Pay DB are configured. Each run is isolated in try/catch.
 */

const INTERVAL_MS = 5 * 60 * 1000;

async function tick(): Promise<void> {
  let due;
  try {
    due = await autopayStore.getDue();
  } catch (error) {
    console.error('[autopay] failed to load due rules:', error);
    return;
  }
  for (const rule of due) {
    const result = await executeAutopayRule(rule);
    if (result.ok) console.log(`[autopay] ran ${rule.id} (${rule.wallet}) → ${result.txHash}`);
    else console.error(`[autopay] run failed for ${rule.id}:`, result.error);
  }
}

export async function startAutopayRunner(): Promise<void> {
  if (!isAutopayExecutorConfigured() || !autopayStore.isConfigured()) {
    console.log('[autopay] runner disabled (needs ZERODEV_PROJECT_ID + Pay DB)');
    return;
  }
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  void tick();
  console.log('[autopay] runner started (5m interval)');
}
