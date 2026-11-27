import { getPayPool } from '../config/postgres.js';
import { notificationStore } from '../services/notificationStore.js';

/*
 * Daily-ish scheduled producer: emits "bill due soon" notifications for billers due within 3 days that
 * haven't been paid this period. Idempotent per biller+period via the notification dedupe key, so it's
 * safe to run repeatedly. See services/payLedgerStore.ts (pay_billers / pay_payments).
 */
const CHECK_MS = 12 * 60 * 60 * 1000; // twice a day
const DUE_WINDOW_DAYS = 3;

interface DueBillRow {
  id: string;
  wallet: string;
  name: string;
  type: string;
  due_day: number;
  default_amount: string | null;
}

async function run(): Promise<void> {
  const pool = getPayPool();
  if (!pool) return;
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const today = now.getDate();
  try {
    const { rows } = await pool.query<DueBillRow>(
      `SELECT b.id, b.wallet, b.name, b.type, b.due_day, b.default_amount
         FROM pay_billers b
        WHERE b.archived_at IS NULL AND b.due_day IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM pay_payments p
             WHERE p.wallet = b.wallet AND p.biller_id = b.id AND p.period = $1
          )`,
      [period],
    );
    for (const b of rows) {
      const diff = Number(b.due_day) - today;
      if (diff < 0 || diff > DUE_WINDOW_DAYS) continue;
      const amt = b.default_amount
        ? `$${Number(b.default_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '';
      await notificationStore
        .emit({
          wallet: b.wallet,
          kind: 'due',
          title: b.type === 'rent' ? 'Rent due soon' : 'Bill due soon',
          body: `${b.name}${amt ? ` · ${amt}` : ''} · ${diff === 0 ? 'due today' : `due in ${diff}d`}`,
          data: { billerId: b.id, href: '/pay' },
          dedupeKey: `due:${b.id}:${period}`,
        })
        .catch(() => {});
    }
  } catch (e) {
    console.error('[dueBillNotifier] error', e);
  }
}

export async function startDueBillNotifier(): Promise<void> {
  await run();
  setInterval(() => void run(), CHECK_MS);
}
