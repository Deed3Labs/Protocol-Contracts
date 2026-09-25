import { merchantDb } from '../config/merchantDb.js';
import { collectBills, raiseBills } from '../services/merchant/fees/feeBilling.js';
import { feeCollectionGap, privyFeeCollector } from '../services/merchant/fees/privyFeeCollector.js';

/*
 * Clear's fee, billed monthly (card-processing prompt, Phase 9): once a day, raise last month's bill
 * for any shop whose processor couldn't take the fee per sale (a no-op once raised), then collect
 * what's due or was short. Only shops on such a processor ever owe anything here; on Stripe alone,
 * it finds nothing. Under an advisory lock so one instance runs it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK = 7_431_205_120;

export async function runClearFeeBilling(now = new Date()): Promise<void> {
  const db = await merchantDb();
  if (!db) return;
  try {
    await db.transaction(async (tx) => {
      const got = await tx.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK]);
      if (!got.rows[0]?.ok) return;
      const raised = await raiseBills(db, { now });
      if (raised.raised.length) console.log(`[clear-fee-billing] raised ${raised.raised.length} bill(s)`);
      for (const f of raised.failed) console.error('[clear-fee-billing] raise:', f);

      const collector = privyFeeCollector();
      if (!collector) return;
      const r = await collectBills(db, collector);
      if (r.collected.length || r.short.length || r.unconfirmed.length) {
        console.log(`[clear-fee-billing] collected ${r.collected.length}; short ${r.short.length}; unconfirmed ${r.unconfirmed.length}`);
      }
    });
  } catch (error) {
    console.error('[clear-fee-billing] failed:', (error as Error)?.message);
  }
}

export function startClearFeeBilling(): void {
  setTimeout(() => void runClearFeeBilling(), 10 * 60 * 1000).unref?.();
  setInterval(() => void runClearFeeBilling(), DAY_MS).unref?.();
  const gap = feeCollectionGap();
  console.log(`[clear-fee-billing] started (daily)${gap ? `; bills are raised but not collected: ${gap}` : ''}`);
}
