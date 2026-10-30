import { merchantDb } from '../config/merchantDb.js';
import { geocodeShops } from '../services/command/geocode.js';

/*
 * The Merchants map's pins: every few minutes, the shops' street addresses not looked up yet go to the US Census
 * geocoder (services/command/geocode.ts), a few at a time. A pass with nothing new is one read.
 *
 * Off with COMMAND_GEOCODE=off.
 */

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  const db = await merchantDb().catch(() => null);
  try {
    if (!db) return;
    const { looked, found } = await geocodeShops(db);
    if (looked) console.log(`[geocode] looked up ${looked} shop address(es), ${found} found`);
  } catch (error) {
    console.error('[geocode] pass failed:', (error as Error).message);
  } finally {
    running = false;
  }
}

export function startCommandGeocoder(): void {
  if (process.env.COMMAND_GEOCODE === 'off') return console.log('[geocode] off (COMMAND_GEOCODE=off)');
  setInterval(() => void tick(), 2 * 60_000);
  void tick();
  console.log('[geocode] shop addresses every 2 minutes');
}
