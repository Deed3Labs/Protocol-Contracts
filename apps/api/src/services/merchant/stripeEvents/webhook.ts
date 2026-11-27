import Stripe from 'stripe';
import type { Queryable } from '../../../db/db.js';
import { type Endpoint, recordEvent } from './inbox.js';

/**
 * Receiving a webhook: verify the signature against the raw body, store the event, answer 200.
 * Nothing is acted on here; the inbox job does that (principle 4). A redelivered event is stored
 * once and answered 200 again, which is what stops Stripe retrying.
 *
 * The Connect endpoint has its own signing secret (STRIPE_CONNECT_WEBHOOK_SECRET): in Stripe it is
 * a separate endpoint, set to receive events from connected accounts (HARD STOP 1, decision 4).
 */
export async function receiveStripeWebhook(input: {
  db: Queryable | null;
  endpoint: Endpoint;
  secret: string;
  rawBody: Buffer | undefined;
  signature: string | undefined;
}): Promise<{ status: number; body: Record<string, unknown>; stored?: boolean }> {
  if (!input.db || !input.secret) return { status: 503, body: { error: 'Unavailable', message: 'webhook not configured' } };
  if (!input.rawBody || !input.signature) return { status: 400, body: { error: 'Invalid request', message: 'missing body or signature' } };

  let event: Stripe.Event;
  try {
    // The async form: under Bun the SDK loads its web build, whose crypto is SubtleCrypto, and the
    // synchronous constructEvent throws there for every event.
    event = await Stripe.webhooks.constructEventAsync(input.rawBody, input.signature, input.secret);
  } catch {
    // Not from Stripe, or not for this endpoint. Say nothing more.
    return { status: 400, body: { error: 'Invalid signature' } };
  }

  const stored = await recordEvent(input.db, input.endpoint, event);
  return { status: 200, body: { received: true }, stored };
}
