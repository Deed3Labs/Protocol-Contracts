import { isRenewalConfigured, renewExpiredPeriods } from '../services/chain/creditPeriodService.js';

/*
 * The cycle rolling over, which nothing else does.
 *
 * Hourly, because a cycle is thirty days: the only thing that matters is that a member who cleared
 * their line is not left on an expired period for long. A pass with nothing to renew is a few reads
 * and no transactions.
 *
 * It runs once at startup too. Every member on a chain that predates this is sitting on an expired
 * period right now, and the first pass is what puts them back on a clock.
 */

const HOUR_MS = 60 * 60 * 1000;

async function tick(): Promise<void> {
  try {
    const results = await renewExpiredPeriods();
    const renewed = results.filter((r) => r.action === 'renewed');
    const carrying = results.filter((r) => r.action === 'carrying');
    const failed = results.filter((r) => r.action === 'failed');
    if (renewed.length) console.log(`[credit-period] renewed ${renewed.length} cycle(s)`);
    // Worth a line even though it is the correct outcome: it is a member inside their grace.
    if (carrying.length) console.log(`[credit-period] ${carrying.length} left in grace with a balance to clear`);
    if (failed.length) console.warn(`[credit-period] ${failed.length} renewal(s) failed`);
  } catch (error) {
    console.error('[credit-period] sweep failed:', (error as Error)?.message);
  }
}

export function startCreditPeriodRenewer(): void {
  if (!isRenewalConfigured()) {
    console.log('[credit-period] renewer disabled (needs the issuer, the operator key and the Pay DB)');
    return;
  }
  setInterval(() => void tick(), HOUR_MS).unref?.();
  void tick();
  console.log('[credit-period] renewer started (hourly)');
}
