import webpush from 'web-push';
import { getPostgresPool } from '../config/postgres.js';

/*
 * Web Push (VAPID) delivery for notifications — lets important notifications arrive when the app is
 * closed (PWA). Subscriptions live in push_subscriptions (see notificationStore.ensureTables). Set
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT in the server env; if unset, this no-ops.
 */
const PUBLIC = process.env.VAPID_PUBLIC_KEY?.trim();
const PRIVATE = process.env.VAPID_PRIVATE_KEY?.trim();
const SUBJECT = process.env.VAPID_SUBJECT?.trim() || 'mailto:support@useclear.org';

let configured = false;
if (PUBLIC && PRIVATE) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
    configured = true;
  } catch (e) {
    console.error('[push] VAPID configuration failed:', e);
  }
}

const TABLE = 'push_subscriptions';

export const pushService = {
  isConfigured: () => configured,

  /** Send a push to every registered subscription for a wallet; prune dead endpoints (404/410). */
  async sendToWallet(wallet: string, payload: { title: string; body: string; data?: Record<string, unknown> | null; tag?: string; badge?: number }): Promise<void> {
    const pool = getPostgresPool();
    if (!pool || !configured) return;
    const w = wallet.trim().toLowerCase();
    let rows: { endpoint: string; subscription: webpush.PushSubscription }[] = [];
    try {
      const res = await pool.query<{ endpoint: string; subscription: webpush.PushSubscription }>(
        `SELECT endpoint, subscription FROM ${TABLE} WHERE owner_wallet = $1`,
        [w],
      );
      rows = res.rows;
    } catch {
      return;
    }
    const body = JSON.stringify({ title: payload.title, body: payload.body, data: payload.data ?? {}, tag: payload.tag, badgeCount: payload.badge });
    await Promise.all(
      rows.map(async (r) => {
        try {
          await webpush.sendNotification(r.subscription, body);
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            await pool.query(`DELETE FROM ${TABLE} WHERE endpoint = $1`, [r.endpoint]).catch(() => {});
          }
        }
      }),
    );
  },
};
