import { merchantDb } from '../config/merchantDb.js';
import { deliverDue } from '../services/merchant/pay/webhooks.js';

/*
 * Sends Pay with Clear's webhook deliveries every 10s (services/merchant/pay/webhooks.ts): each due
 * delivery once, signed, retried with backoff for 3 days.
 */

const EVERY_MS = 10_000;
let running = false;

export async function sendWebhooks(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = await merchantDb();
    if (!db) return;
    // A full batch means more are waiting: keep going until a short one.
    while ((await deliverDue(db, { fetch })) === 20);
  } catch (error) {
    console.error('[webhooks] delivery failed:', (error as Error)?.message);
  } finally {
    running = false;
  }
}

export function startWebhookDeliveries(): void {
  setInterval(() => void sendWebhooks(), EVERY_MS).unref?.();
  console.log('[webhooks] started (every 10s)');
}
