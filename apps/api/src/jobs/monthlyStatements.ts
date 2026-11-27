import { merchantDb } from '../config/merchantDb.js';
import { sendMonthlyStatements } from '../services/merchant/statements.js';
import { sendNotificationService } from '../services/sendNotificationService.js';

/*
 * Each month's statement, emailed on the 2nd (Settings › Payouts › Email each statement). Daily,
 * under an advisory lock so one instance runs it; a month is sent once (merchant.statement_sends).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK = 7_431_205_121;

export async function runMonthlyStatements(now = new Date()): Promise<void> {
  const db = await merchantDb();
  if (!db) return;
  try {
    await db.transaction(async (tx) => {
      const got = await tx.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK]);
      if (!got.rows[0]?.ok) return;
      const r = await sendMonthlyStatements(db, { configured: () => sendNotificationService.emailConfigured(), send: (e) => sendNotificationService.sendEmail(e) }, now);
      if (r.sent.length || r.failed.length) console.log(`[monthly-statements] sent ${r.sent.length}; failed ${r.failed.length}`);
    });
  } catch (error) {
    console.error('[monthly-statements] failed:', (error as Error)?.message);
  }
}

export function startMonthlyStatements(): void {
  setTimeout(() => void runMonthlyStatements(), 15 * 60 * 1000).unref?.();
  setInterval(() => void runMonthlyStatements(), DAY_MS).unref?.();
  console.log('[monthly-statements] started (daily)');
}
