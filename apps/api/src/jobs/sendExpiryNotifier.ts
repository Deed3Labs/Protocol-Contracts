import { sendTransferStore } from '../services/sendTransferStore.js';
import { notificationStore } from '../services/notificationStore.js';

/*
 * Hourly scheduled producer: flips past-expiry unclaimed send transfers to EXPIRED and notifies each
 * sender exactly once that their claim-link went unclaimed. The DB UPDATE ... RETURNING sweep is the
 * idempotency guard (a transfer only flips once), and the notification dedupe key is a second guard.
 * See services/sendTransferStore.ts (expireStaleTransfers) and routes/send.ts (the lazy per-claim
 * expiry check that this backstops for links no recipient ever revisits).
 */
const CHECK_MS = 60 * 60 * 1000; // hourly

async function run(): Promise<void> {
  if (!sendTransferStore.isConfigured()) return;
  try {
    const expired = await sendTransferStore.expireStaleTransfers();
    for (const t of expired) {
      const usd = Number(t.principalUsdc) / 1_000_000;
      await notificationStore
        .emit({
          wallet: t.senderWallet,
          kind: 'system',
          title: 'Payment expired',
          body: `Your $${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} payment wasn't claimed in time`,
          data: { transferId: t.id, href: '/transactions' },
          dedupeKey: `send:${t.id}:expired`,
        })
        .catch(() => {});
    }
  } catch (e) {
    console.error('[sendExpiryNotifier] error', e);
  }
}

export async function startSendExpiryNotifier(): Promise<void> {
  await run();
  setInterval(() => void run(), CHECK_MS);
}
