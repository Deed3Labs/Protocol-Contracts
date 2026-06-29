import { autopayStore } from '../services/autopayStore.js';
import { runSavingsDeposit, isAutopayExecutorConfigured } from '../services/autopayService.js';
import { savingsGaslessService } from '../services/savingsGaslessService.js';
import { payLedgerStore, networkFromChainId } from '../services/payLedgerStore.js';

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
    try {
      const txHash = await runSavingsDeposit({
        chainId: rule.chainId,
        approval: rule.approval,
        wallet: rule.wallet,
        amountUsdc: rule.amountUsdc,
      });
      await autopayStore.recordSuccess(rule, txHash);
      console.log(`[autopay] ran ${rule.id} (${rule.wallet}) → ${txHash}`);

      // Equity-credit match from the verified on-chain deposit amount (best-effort).
      try {
        const amt = await savingsGaslessService.verifySavingsTx({
          chainId: rule.chainId,
          txHash,
          action: 'deposit',
          wallet: rule.wallet,
        });
        if (amt != null) {
          await payLedgerStore.recordDepositMatch({
            wallet: rule.wallet,
            amountMicros: amt,
            txRef: txHash,
            network: networkFromChainId(rule.chainId),
          });
        }
      } catch (error) {
        console.warn('[autopay] credit record failed:', error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Autopay run failed';
      await autopayStore.recordFailure(rule, message).catch(() => {});
      console.error(`[autopay] run failed for ${rule.id}:`, message);
    }
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
