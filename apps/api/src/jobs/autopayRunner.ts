import { autopayStore } from '../services/autopayStore.js';
import { executeAutopayRule, isAutopayExecutorConfigured } from '../services/autopayService.js';

/*
 * Autopay runner — polls for due savings-deposit rules and submits each one's signed on-chain
 * `DepositMandate` through the savings relayer (`executeMandateDeposit`; no user signing, the relayer
 * pays gas, the vault enforces amount, cadence, runs and expiry). No session key is involved. On
 * success it awards equity credits from the verified on-chain amount; on failure it records the error and the store pushes the next run out for retry.
 * Disabled unless ZERODEV_PROJECT_ID + the Pay DB are configured (the ZeroDev gate is a leftover of
 * the session-key design; the mandate path does not use ZeroDev). Each run is isolated in try/catch.
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
