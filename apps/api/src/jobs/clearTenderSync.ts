import { merchantDb } from '../config/merchantDb.js';
import { chargeEvents } from '../services/chargeStore.js';
import { clearChargesFor } from '../services/merchant/orders/clearCharges.js';
import { syncClearTender } from '../services/merchant/orders/payments.js';

/*
 * Keeps Clear tenders in step with their charges.
 *
 *   on answer   the charge store's 'resolved' event (approved, declined, cancelled): synced at once
 *   every 20s   a sweep of pending Clear tenders, for expiries (never written, so never announced),
 *               a missed event, or another instance's answer
 *
 * The app also syncs while it waits on the counter screen. All three go through the same row lock
 * and state machine, so whichever lands first wins and the rest find nothing to do.
 */

const SWEEP_MS = 20_000;
let running = false;

async function syncByCode(code: string): Promise<void> {
  const db = await merchantDb();
  if (!db) return;
  const { rows } = await db.query<{ id: string; merchant: string }>(`SELECT id, merchant FROM payments.tenders WHERE clear_charge_code = $1 AND status = 'pending'`, [code]);
  for (const t of rows) await syncClearTender(db, clearChargesFor(db), { merchant: t.merchant, tenderId: t.id, actor: null });
}

export async function sweepClearTenders(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = await merchantDb();
    if (!db) return;
    const { rows } = await db.query<{ id: string; merchant: string }>(
      `SELECT id, merchant FROM payments.tenders WHERE method = 'clear' AND status = 'pending' AND clear_charge_code IS NOT NULL ORDER BY created_at LIMIT 200`,
    );
    const clear = clearChargesFor(db);
    for (const t of rows) {
      await syncClearTender(db, clear, { merchant: t.merchant, tenderId: t.id, actor: null }).catch((error) =>
        console.error(`[clear-tenders] ${t.id}:`, error instanceof Error ? error.message : error),
      );
    }
  } catch (error) {
    console.error('[clear-tenders] sweep failed:', (error as Error)?.message);
  } finally {
    running = false;
  }
}

export function startClearTenderSync(): void {
  chargeEvents.on('resolved', (charge: { code: string }) => {
    void syncByCode(charge.code).catch((error) => console.error('[clear-tenders] sync on answer failed:', error instanceof Error ? error.message : error));
  });
  setInterval(() => void sweepClearTenders(), SWEEP_MS).unref?.();
  console.log('[clear-tenders] started (on answer, and a sweep every 20s)');
}
