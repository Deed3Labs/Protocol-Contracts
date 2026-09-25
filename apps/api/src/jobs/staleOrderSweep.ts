import { merchantDb } from '../config/merchantDb.js';
import { sweepStaleOrders } from '../services/merchant/orders/payments.js';

/*
 * Unpaid orders left behind (card-processing prompt; UI Phase 6): every 15 minutes, an order with no
 * money on it and untouched for two hours is discarded, so its stock isn't held for nobody. The app
 * discards on the way out; this catches a tab closed or a tablet gone dark mid-charge. Under an
 * advisory lock so one instance runs it.
 */

const EVERY_MS = 15 * 60 * 1000;
const LOCK = 7_431_205_121;

export async function runStaleOrderSweep(now = new Date()): Promise<void> {
  const db = await merchantDb();
  if (!db) return;
  try {
    await db.transaction(async (tx) => {
      const got = await tx.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK]);
      if (!got.rows[0]?.ok) return;
      const discarded = await sweepStaleOrders(db, { now });
      if (discarded.length) console.log(`[stale-orders] discarded ${discarded.length} unpaid order(s) left open`);
    });
  } catch (error) {
    console.error('[stale-orders] failed:', (error as Error)?.message);
  }
}

export function startStaleOrderSweep(): void {
  setInterval(() => void runStaleOrderSweep(), EVERY_MS).unref?.();
  console.log('[stale-orders] started (every 15m, unpaid orders idle 2h)');
}
