import type { Db, Queryable } from '../../../db/db.js';

/**
 * The outbox (card-processing prompt, Phase 2): facts written in the same transaction as the change
 * they describe ("order.paid", "refund.succeeded"), and acted on afterwards, so a slow or failing
 * outside service (Stripe Tax, notifications) never holds up or undoes a sale.
 *
 * Drained like the Stripe inbox: one event at a time, FOR UPDATE SKIP LOCKED so instances share the
 * work, the handler in the same transaction that marks it published, and failures backing off.
 */

export const MAX_OUTBOX_ATTEMPTS = 12;
export const outboxDelayMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);

export interface OutboxEvent {
  id: number;
  merchant: string;
  topic: string;
  dedupe_key: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export type OutboxHandler = (tx: Queryable, event: OutboxEvent) => Promise<void>;

export async function processOutbox(db: Db, handlers: Partial<Record<string, OutboxHandler>>, opts: { now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const result = { published: 0, failed: 0 };
  for (let i = 0; i < (opts.limit ?? 100); i++) {
    let claimed: OutboxEvent | null = null;
    try {
      const done = await db.transaction(async (tx) => {
        const { rows } = await tx.query<OutboxEvent>(
          `SELECT id, merchant, topic, dedupe_key, payload, attempts FROM payments.outbox
            WHERE published_at IS NULL AND attempts < $1 AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
            ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [MAX_OUTBOX_ATTEMPTS, now.toISOString()],
        );
        const e = rows[0];
        if (!e) return false;
        claimed = { ...e, payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload };
        // A topic nobody acts on yet is published as is: it stays readable for whoever comes later.
        await handlers[e.topic]?.(tx, claimed);
        await tx.query('UPDATE payments.outbox SET published_at = now(), attempts = attempts + 1, error = NULL WHERE id = $1', [e.id]);
        return true;
      });
      if (!done) break;
      result.published += 1;
    } catch (error) {
      const e = claimed as OutboxEvent | null;
      if (!e) throw error;
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await db.query('UPDATE payments.outbox SET attempts = attempts + 1, error = $2, next_attempt_at = $3 WHERE id = $1', [
        e.id,
        message.slice(0, 2000),
        new Date(now.getTime() + outboxDelayMs(e.attempts + 1)).toISOString(),
      ]);
      console.error(`[outbox] ${e.topic} ${e.dedupe_key} failed, attempt ${e.attempts + 1}:`, message);
    }
  }
  return result;
}
