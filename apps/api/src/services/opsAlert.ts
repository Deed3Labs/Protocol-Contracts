import { getPostgresPool } from '../config/postgres.js';
import { sendNotificationService } from './sendNotificationService.js';

/*
 * Telling Clear's team when money needs a person.
 *
 * Almost everything that moves money retries itself until it lands. What is left is the narrow case
 * where a transfer may have left with nothing to check it by, or the chain did something it should
 * not have (a plan transaction that succeeded without opening a plan). Those are not retried blind,
 * so somebody has to look — and a line in a server log is not somebody looking.
 *
 * So each one is emailed to OPS_ALERT_EMAIL (comma-separated addresses), once: an alert is keyed on
 * what it is about, and a sweep that meets the same stuck transfer every minute does not send a
 * message every minute. Without the variable, or without a database to remember what was sent, it
 * is only logged.
 */

const TABLE = 'ops_alerts';
let ensured = false;

function recipients(): string[] {
  return (process.env.OPS_ALERT_EMAIL || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

export async function alertOps(input: { key: string; subject: string; body: string }): Promise<void> {
  console.error(`[ops-alert] ${input.subject} — ${input.body}`);
  const to = recipients();
  const pool = getPostgresPool();
  if (!to.length || !pool) return;
  try {
    if (!ensured) {
      await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
        key TEXT PRIMARY KEY, subject TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      ensured = true;
    }
    const { rows } = await pool.query<{ key: string }>(
      `INSERT INTO ${TABLE} (key, subject, body) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING RETURNING key`,
      [input.key, input.subject, input.body],
    );
    if (!rows[0]) return; // already told
    for (const address of to) {
      await sendNotificationService
        .sendEmail({ to: address, subject: `[Clear] ${input.subject}`, body: `${input.body}\n\nReference: ${input.key}` })
        .catch((error) => console.error('[ops-alert] email failed', error instanceof Error ? error.message : error));
    }
  } catch (error) {
    console.error('[ops-alert] could not record or send', error instanceof Error ? error.message : error);
  }
}
