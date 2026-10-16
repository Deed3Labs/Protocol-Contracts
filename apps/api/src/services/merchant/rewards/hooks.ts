import type { Queryable } from '../../../db/db.js';
import type { OutboxHandler } from '../outbox/outbox.js';
import { onOrderPaid, onOrderRefunded, onOrderUnpaid } from './ledger.js';

/**
 * Where rewards rides on a payment: called from `settleOrder` and the refund paths, in their own
 * transaction, so the points are there the moment the sale is. Inside a savepoint: if the rewards
 * step fails, the sale still stands, and an outbox event runs the same (idempotent) step again.
 */

export type RewardsEvent =
  | { kind: 'paid'; orderId: string; attempt: number }
  | { kind: 'unpaid'; orderId: string }
  | { kind: 'refunded'; orderId: string; key: string };

async function run(tx: Queryable, merchant: string, e: RewardsEvent): Promise<void> {
  if (e.kind === 'paid') return onOrderPaid(tx, { merchant, orderId: e.orderId, attempt: e.attempt });
  if (e.kind === 'unpaid') return onOrderUnpaid(tx, { merchant, orderId: e.orderId });
  return onOrderRefunded(tx, { merchant, orderId: e.orderId, key: e.key });
}

const keyOf = (e: RewardsEvent) => (e.kind === 'paid' ? `paid:${e.orderId}:${e.attempt}` : e.kind === 'unpaid' ? `unpaid:${e.orderId}:${Date.now()}` : `refunded:${e.key}`);

export async function rewardsOn(tx: Queryable, merchant: string, e: RewardsEvent): Promise<void> {
  // Nothing to do for a shop without an app; and no savepoint cost on every sale for those shops.
  const { rows } = await tx.query('SELECT 1 FROM rewards.shop_apps WHERE merchant = $1', [merchant]);
  if (!rows[0]) return;
  await tx.query('SAVEPOINT rewards_hook');
  try {
    await run(tx, merchant, e);
    await tx.query('RELEASE SAVEPOINT rewards_hook');
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT rewards_hook');
    console.error(`[rewards] ${e.kind} ${e.orderId} failed; queued to try again:`, error instanceof Error ? error.message : error);
    await tx.query(
      `INSERT INTO payments.outbox (merchant, topic, dedupe_key, payload) VALUES ($1, 'rewards.retry', $2, $3) ON CONFLICT (dedupe_key) DO NOTHING`,
      [merchant, `rewards.retry:${keyOf(e)}`, JSON.stringify(e)],
    );
  }
}

/** The outbox's retry of a step that failed inline. */
export const rewardsOutboxHandlers: Record<string, OutboxHandler> = {
  'rewards.retry': async (tx, event) => run(tx, event.merchant, event.payload as unknown as RewardsEvent),
};

/**
 * A Clear refund settles outside the merchant books (`refundSettlement.settleRefund`), and the order
 * stays paid; its points are taken back here, keyed on the charge and how much is refunded so far.
 */
export async function rewardsOnClearRefund(db: { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> }, chargeCode: string, amountCents: number): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ merchant: string; order_id: string }>('SELECT merchant, order_id FROM payments.tenders WHERE clear_charge_code = $1 LIMIT 1', [chargeCode]);
    const t = rows[0];
    if (!t) return;
    await rewardsOn(tx, t.merchant, { kind: 'refunded', orderId: t.order_id, key: `clear:${chargeCode}:${amountCents}` });
  });
}
