import type Stripe from 'stripe';
import type { Db, Queryable } from '../../../db/db.js';

/**
 * The Stripe webhook inbox (card-processing prompt, principle 4): store the event, acknowledge it,
 * process it afterwards, idempotently, keyed on Stripe's event id.
 *
 * - `record` is all the webhook route does. A redelivery hits the primary key and changes nothing.
 * - `processPending` takes one unprocessed event at a time with FOR UPDATE SKIP LOCKED, so any
 *   number of API instances can drain the inbox without two handling the same event, and runs its
 *   handler in the SAME transaction that marks it processed: the handler's writes and "done" commit
 *   together, or neither does and the event is tried again.
 * - A failed event backs off (retryDelayMs) and stops after MAX_ATTEMPTS, about six and a half hours
 *   of trying, with its last error kept for a person. Within one run an event that failed is not
 *   picked again: it waits for its next attempt time like any other.
 */

export const MAX_ATTEMPTS = 12;

/** 30s, then doubling, capped at an hour. */
export function retryDelayMs(attemptsSoFar: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attemptsSoFar - 1), 3_600_000);
}

export type Endpoint = 'platform' | 'connect';

export interface StoredEvent {
  event_id: string;
  endpoint: Endpoint;
  type: string;
  account: string | null;
  livemode: boolean;
  payload: Stripe.Event;
  attempts: number;
}

/** What a handler is given: the event, and the transaction it must write in. */
export type EventHandler = (tx: Queryable, event: Stripe.Event) => Promise<void>;
export type Handlers = Partial<Record<string, EventHandler>>;

/** Stores a verified event. True if it's new; false for a redelivery. */
export async function recordEvent(db: Queryable, endpoint: Endpoint, event: Stripe.Event): Promise<boolean> {
  const { rows } = await db.query<{ event_id: string }>(
    `INSERT INTO payments.stripe_events (event_id, endpoint, type, account, livemode, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [event.id, endpoint, event.type, event.account ?? null, event.livemode, JSON.stringify(event)],
  );
  return rows.length > 0;
}

export interface ProcessResult {
  processed: number;
  skipped: number;
  failed: number;
}

/**
 * Handles waiting events until none are left or `limit` is reached.
 *
 * @param livemode the mode of this environment's key. A production Connect endpoint receives both
 *   live and test events (docs.stripe.com/connect/webhooks), so an event in the other mode is
 *   marked processed and left alone rather than acted on.
 */
export async function processPending(
  db: Db,
  handlers: Handlers,
  opts: { livemode: boolean; limit?: number; now?: Date },
): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, skipped: 0, failed: 0 };
  const limit = opts.limit ?? 100;
  const now = opts.now ?? new Date();
  for (let i = 0; i < limit; i++) {
    let claimed: StoredEvent | null = null;
    try {
      const outcome = await db.transaction(async (tx) => {
        const { rows } = await tx.query<StoredEvent>(
          `SELECT event_id, endpoint, type, account, livemode, payload, attempts FROM payments.stripe_events
            WHERE processed_at IS NULL AND attempts < $1
              AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
            ORDER BY received_at, event_id
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          [MAX_ATTEMPTS, now.toISOString()],
        );
        const row = rows[0];
        if (!row) return 'empty' as const;
        claimed = row;
        const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as Stripe.Event;

        let note: string | null = null;
        if (row.livemode !== opts.livemode) note = `skipped: a ${row.livemode ? 'live' : 'test'} event in a ${opts.livemode ? 'live' : 'test'} environment`;
        else if (!handlers[row.type]) note = 'skipped: no handler for this type';
        else await handlers[row.type]!(tx, payload);

        await tx.query(
          'UPDATE payments.stripe_events SET processed_at = now(), attempts = attempts + 1, error = $2 WHERE event_id = $1',
          [row.event_id, note],
        );
        return note ? ('skipped' as const) : ('processed' as const);
      });
      if (outcome === 'empty') break;
      result[outcome] += 1;
    } catch (error) {
      const failed = claimed as StoredEvent | null;
      if (!failed) throw error;
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      // Outside the rolled-back transaction, so the attempt is counted and the reason kept.
      const nextAt = new Date(now.getTime() + retryDelayMs(failed.attempts + 1));
      await db.query('UPDATE payments.stripe_events SET attempts = attempts + 1, error = $2, next_attempt_at = $3 WHERE event_id = $1', [
        failed.event_id,
        message.slice(0, 2000),
        nextAt.toISOString(),
      ]);
      console.error(`Stripe event ${failed.event_id} (${failed.type}) failed, attempt ${failed.attempts + 1}:`, message);
    }
  }
  return result;
}
