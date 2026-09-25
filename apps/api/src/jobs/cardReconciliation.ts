import { merchantDb } from '../config/merchantDb.js';
import { defaultCardConnector } from '../services/merchant/cards/stripeConnector.js';
import { syncRecentPayouts } from '../services/merchant/payouts/payoutSync.js';
import { reconcileAll } from '../services/merchant/payouts/reconcile.js';

/*
 * Nightly: bring every shop's card payouts up to date (a backstop for the payout webhooks), then
 * compare our books with the processor's and flag what disagrees (card-processing prompt, Phase 8).
 * Once a day, a few minutes after start; under an advisory lock so one instance runs it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 14;
const LOCK = 7_431_205_119;

export async function runCardReconciliation(now = new Date()): Promise<void> {
  const db = await merchantDb();
  const provider = defaultCardConnector();
  if (!db || !provider) return;
  try {
    await db.transaction(async (tx) => {
      const got = await tx.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK]);
      if (!got.rows[0]?.ok) return;
      const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
      const synced = await syncRecentPayouts(db, provider, { since });
      const results = await reconcileAll(db, provider, { since });
      const flags = results.reduce((n, r) => n + ('flags' in r ? r.flags : 0), 0);
      console.log(`[card-reconciliation] payouts synced ${synced.synced}; shops checked ${results.length}; open flags ${flags}`);
      for (const f of synced.failed) console.error('[card-reconciliation] payout sync:', f);
      for (const r of results) if ('error' in r) console.error(`[card-reconciliation] ${r.merchant}:`, r.error);
    });
  } catch (error) {
    console.error('[card-reconciliation] failed:', (error as Error)?.message);
  }
}

export function startCardReconciliation(): void {
  setTimeout(() => void runCardReconciliation(), 5 * 60 * 1000).unref?.();
  setInterval(() => void runCardReconciliation(), DAY_MS).unref?.();
  console.log('[card-reconciliation] started (daily)');
}
