import { merchantDb } from '../config/merchantDb.js';
import { sendMail } from '../services/command/mail.js';
import { sendInvites } from '../services/command/waitlist.js';

/*
 * The Command Center's invite emails (Phase 7b): a batch, once approved, queues one email for each
 * person it took; this sends them a minute at a time through Resend, and tries a failed one again
 * up to 5 times, 10 minutes apart. Off with COMMAND_INVITES=off.
 */

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  const db = await merchantDb().catch(() => null);
  try {
    if (!db) return;
    const r = await sendInvites(db, sendMail, new Date());
    if (r.sent || r.failed) console.log(`[invites] sent ${r.sent}${r.failed ? `, ${r.failed} failed (tried again later)` : ''}`);
  } catch (error) {
    console.error('[invites] run failed:', (error as Error).message);
  } finally {
    running = false;
  }
}

export function startCommandInvites(): void {
  if (process.env.COMMAND_INVITES === 'off') return console.log('[invites] off (COMMAND_INVITES=off)');
  setInterval(() => void tick(), 60_000);
  void tick();
}
