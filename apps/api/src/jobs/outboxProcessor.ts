import { merchantDb } from '../config/merchantDb.js';
import { processOutbox } from '../services/merchant/outbox/outbox.js';
import { defaultTaxApi } from '../services/merchant/tax/taxApi.js';
import { taxRecordHandlers } from '../services/merchant/tax/taxRecorder.js';

/*
 * Acts on the merchant back office's outbox every 15s: today, recording and reversing tax at
 * Stripe. Topics nobody acts on yet ("card.dispute_opened") are marked published and kept.
 */

const EVERY_MS = 15_000;
let running = false;
const HANDLERS = taxRecordHandlers(defaultTaxApi);

export async function drainOutbox(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = await merchantDb();
    if (!db) return;
    const r = await processOutbox(db, HANDLERS);
    if (r.failed) console.log(`[outbox] published ${r.published}, failed ${r.failed}`);
  } catch (error) {
    console.error('[outbox] drain failed:', (error as Error)?.message);
  } finally {
    running = false;
  }
}

export function startOutboxProcessor(): void {
  setInterval(() => void drainOutbox(), EVERY_MS).unref?.();
  console.log('[outbox] started (every 15s)');
}
