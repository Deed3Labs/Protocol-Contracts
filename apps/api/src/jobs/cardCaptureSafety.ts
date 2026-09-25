import { merchantDb } from '../config/merchantDb.js';
import { captureDue } from '../services/merchant/cards/cardTenders.js';
import { defaultCardConnector } from '../services/merchant/cards/stripeConnector.js';

/*
 * The safety capture (card-processing prompt, Phase 4). Cards are authorised at the tap and captured
 * at Close the day. A day nobody closes would otherwise let the hold lapse: Stripe releases an
 * uncaptured in-person authorisation after 2 days, and the shop loses the sale.
 *
 * So every 30 minutes this captures any card authorised more than 36 hours ago: long after any
 * normal close, and 12 hours inside the window. Under an advisory lock, so one instance runs it;
 * each capture is keyed at the processor as well, so even two would take the money once.
 */

const EVERY_MS = 30 * 60 * 1000;
export const SAFETY_CAPTURE_AFTER_MS = 36 * 60 * 60 * 1000;
const LOCK = 7_431_205_118;

export async function runSafetyCapture(now = new Date()): Promise<void> {
  const db = await merchantDb();
  const provider = defaultCardConnector();
  if (!db || !provider) return;
  try {
    // A transaction-scoped lock, held while the run goes on: a session lock on a pooled connection
    // can be taken on one connection and released on another, and then it's never released.
    await db.transaction(async (tx) => {
      const got = await tx.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK]);
      if (!got.rows[0]?.ok) return;
      const r = await captureDue(db, provider, { authorisedBefore: new Date(now.getTime() - SAFETY_CAPTURE_AFTER_MS) });
      if (r.captured.length) console.log(`[card-capture-safety] captured ${r.captured.length} card payment(s) nobody closed`);
      for (const f of r.failed) console.error(`[card-capture-safety] ${f.tenderId}: ${f.error}`);
    });
  } catch (error) {
    console.error('[card-capture-safety] failed:', (error as Error)?.message);
  }
}

export function startCardCaptureSafety(): void {
  setInterval(() => void runSafetyCapture(), EVERY_MS).unref?.();
  console.log('[card-capture-safety] started (every 30m, cards authorised over 36h ago)');
}
