import { merchantDb } from '../config/merchantDb.js';
import { captureDue } from '../services/merchant/cards/cardTenders.js';
import type { CardConnectorProvider } from '../services/merchant/cards/connector.js';
import { cardConnectors } from '../services/merchant/cards/registry.js';

/*
 * The safety capture (card-processing prompt, Phase 4). Cards are authorised at the tap and captured
 * at Close the day. A day nobody closes would otherwise let the hold lapse: the processor releases
 * an uncaptured in-person authorisation (Stripe after 2 days, Square after 36 hours), and the shop
 * loses the sale.
 *
 * So every 30 minutes this captures any card held for most of its processor's window: 12 hours
 * inside it, long after any normal close (36 hours on Stripe). Under an advisory lock, so one
 * instance runs it; each capture is keyed at the processor as well, so even two would take the
 * money once.
 */

const EVERY_MS = 30 * 60 * 1000;
/** How far inside the processor's hold the safety capture acts. */
export const SAFETY_MARGIN_MS = 12 * 60 * 60 * 1000;
const LOCK = 7_431_205_118;

/** When a card on this processor is captured by the safety job rather than waiting for a close. */
export const safetyCaptureAfterMs = (provider: CardConnectorProvider) => provider.authorisationHoldMs - SAFETY_MARGIN_MS;

export async function runSafetyCapture(now = new Date(), providers: CardConnectorProvider[] = cardConnectors()): Promise<void> {
  const db = await merchantDb();
  if (!db || providers.length === 0) return;
  try {
    // A transaction-scoped lock, held while the run goes on: a session lock on a pooled connection
    // can be taken on one connection and released on another, and then it's never released.
    await db.transaction(async (tx) => {
      const got = await tx.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK]);
      if (!got.rows[0]?.ok) return;
      for (const provider of providers) {
        // Cards on an account the shop disconnected can't be captured by Clear; the close named
        // them and the nightly reconciliation flags them, so they aren't retried here every 30m.
        const r = await captureDue(db, provider, { authorisedBefore: new Date(now.getTime() - safetyCaptureAfterMs(provider)), liveOnly: true });
        if (r.captured.length) console.log(`[card-capture-safety] ${provider.provider}: captured ${r.captured.length} card payment(s) nobody closed`);
        for (const f of r.failed) console.error(`[card-capture-safety] ${f.tenderId}: ${f.error}`);
      }
    });
  } catch (error) {
    console.error('[card-capture-safety] failed:', (error as Error)?.message);
  }
}

export function startCardCaptureSafety(): void {
  setInterval(() => void runSafetyCapture(), EVERY_MS).unref?.();
  console.log('[card-capture-safety] started (every 30m, cards held within 12h of their processor’s window)');
}
