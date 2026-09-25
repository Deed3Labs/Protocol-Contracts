import { merchantDb } from '../config/merchantDb.js';
import { stripeLivemode } from '../services/merchant/cards/stripeConnector.js';
import { cardConnectorHandlers } from '../services/merchant/stripeEvents/cardConnectorHandlers.js';
import { cardPaymentHandlers } from '../services/merchant/stripeEvents/cardPaymentHandlers.js';
import { defaultCardConnector } from '../services/merchant/cards/stripeConnector.js';
import { type Handlers, processPending } from '../services/merchant/stripeEvents/inbox.js';

/*
 * Drains the Stripe webhook inbox (payments.stripe_events).
 *
 *   on arrival   the webhook route kicks it, so a stored event is usually handled within the second
 *   every 30s    a sweep, for anything a kick missed: a crash between storing and handling, a
 *                handler that failed and is due another go, an instance that was busy
 *
 * Safe on several instances at once: events are claimed with FOR UPDATE SKIP LOCKED, so a second
 * instance takes the next event rather than waiting on, or repeating, the first.
 */

const SWEEP_MS = 30_000;

/** Every event type the merchant back office acts on. Later phases add theirs here. */
export const MERCHANT_STRIPE_HANDLERS: Handlers = {
  ...cardConnectorHandlers,
  ...cardPaymentHandlers(defaultCardConnector),
};

let running = false;
let again = false;

export async function drainStripeEvents(): Promise<void> {
  if (running) {
    // Something arrived mid-drain; go round once more rather than leave it for the sweep.
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const db = await merchantDb();
      if (!db) return;
      const r = await processPending(db, MERCHANT_STRIPE_HANDLERS, { livemode: stripeLivemode() });
      if (r.processed || r.failed) console.log(`[stripe-events] processed ${r.processed}, skipped ${r.skipped}, failed ${r.failed}`);
    } while (again);
  } catch (error) {
    console.error('[stripe-events] drain failed:', (error as Error)?.message);
  } finally {
    running = false;
  }
}

export function startStripeEventProcessor(): void {
  setInterval(() => void drainStripeEvents(), SWEEP_MS).unref?.();
  void drainStripeEvents();
  console.log('[stripe-events] started (on arrival, and a sweep every 30s)');
}
