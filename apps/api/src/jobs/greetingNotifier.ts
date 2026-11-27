import { getPostgresPool } from '../config/postgres.js';
import { notificationStore } from '../services/notificationStore.js';

/*
 * Time-of-day greeting notifications (morning / afternoon / evening) — a gentle nudge to open the app,
 * and a live end-to-end test of the notification + push pipeline. Sent to opted-in users (those with a
 * Web Push subscription). Idempotent per day+period via the dedupe key, and time-of-day is computed in
 * APP_TZ (default America/New_York) so "good morning" lands in the morning regardless of server TZ.
 */
const CHECK_MS = 30 * 60 * 1000; // every 30 minutes
const TZ = process.env.APP_TZ || 'America/New_York';

function greetingForHour(hour: number): { period: string; title: string; body: string } | null {
  if (hour === 9) return { period: 'morning', title: 'Good morning ☀️', body: 'Here’s where your money stands today.' };
  if (hour === 15) return { period: 'afternoon', title: 'Good afternoon 👋', body: 'A quick check-in on your accounts and upcoming bills.' };
  if (hour === 21) return { period: 'evening', title: 'Good evening 🌙', body: 'Review today’s spending and your Clear Deed progress.' };
  return null;
}

async function run(): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(now));
  const greeting = greetingForHour(hour);
  if (!greeting) return;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); // YYYY-MM-DD

  try {
    const { rows } = await pool.query<{ owner_wallet: string }>(`SELECT DISTINCT owner_wallet FROM push_subscriptions`);
    for (const r of rows) {
      await notificationStore
        .emit({
          wallet: r.owner_wallet,
          kind: 'system',
          title: greeting.title,
          body: greeting.body,
          data: { href: '/' },
          dedupeKey: `greeting:${date}:${greeting.period}`,
          push: true,
        })
        .catch(() => {});
    }
  } catch (e) {
    console.error('[greetingNotifier] error', e);
  }
}

export async function startGreetingNotifier(): Promise<void> {
  await run();
  setInterval(() => void run(), CHECK_MS);
}
