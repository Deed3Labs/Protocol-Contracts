import { merchantDb } from '../config/merchantDb.js';
import { sweepLapsed } from '../services/merchant/terminal/floor.js';

/*
 * Clear Terminal: what lapses by itself. What a Point shows is worked out when asked, so a hold, a
 * Call or a paid bill lapses on time without this; the sweep tidies the rows (a hold's table is
 * seated, a lapsed Call closed) and wakes the shops' Points.
 */

const SWEEP_MS = 30_000;
let running = false;

export async function sweepTerminal(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = await merchantDb();
    if (db) await sweepLapsed(db);
  } catch (error) {
    console.error('[terminal] sweep failed:', (error as Error)?.message);
  } finally {
    running = false;
  }
}

export function startTerminalSweep(): void {
  setInterval(() => void sweepTerminal(), SWEEP_MS).unref?.();
  console.log('[terminal] started (holds, Calls and Bills lapse; a sweep every 30s)');
}
