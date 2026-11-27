import { autoOffersOn, isOffersConfigured, reviewOffers } from '../services/credit/offersService.js';

/*
 * The co-op's $10 offers: given to verified members who haven't had one, taken back when they go
 * unspent past their window, and the line paid down from the Safe's allowance.
 *
 * Hourly, like the term-limit reviewer it shares the operator key's queue with: an hour's wait for a
 * $10 is nothing, and a pass where nobody is due one is reads and no transactions. It runs once at
 * startup too, which is what reaches members who joined before it was switched on.
 */

const HOUR_MS = 60 * 60 * 1000;

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { results } = await reviewOffers();
    const count = (a: string) => results.filter((r) => r.action === a).length;
    if (count('granted')) console.log(`[offers] gave ${count('granted')} offer(s)`);
    if (count('expired')) console.log(`[offers] took back ${count('expired')} unspent offer(s)`);
    if (count('cap-reached')) console.warn(`[offers] ${count('cap-reached')} member(s) waiting: the line is at its cap`);
    if (count('failed')) console.warn(`[offers] ${count('failed')} failed`);
  } catch (error) {
    console.error('[offers] pass failed:', (error as Error)?.message);
  } finally {
    running = false;
  }
}

export function startOffersGranter(): void {
  if (!isOffersConfigured()) {
    console.log('[offers] granter disabled (needs OffersIssuer, the operator key and the members database)');
    return;
  }
  if (!autoOffersOn()) {
    console.log('[offers] granter disabled (AUTO_OFFERS is off on this chain)');
    return;
  }
  setInterval(() => void tick(), HOUR_MS).unref?.();
  void tick();
  console.log('[offers] granter started (hourly)');
}
