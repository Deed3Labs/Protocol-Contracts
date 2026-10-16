import { z } from 'zod';
import { EventId, HttpsUrl, Livemode, Timestamp, WebhookDeliveryId, WebhookEndpointId } from './common';
import { PaymentEventObject } from './payments';
import { Refund } from './refunds';
import { CLEAR_VERSIONS } from './versions';

/**
 * Webhooks: how the shop's server learns what happened, and the one to fulfil orders from. Each event
 * is written in the same transaction as the change it describes, delivered to every endpoint that
 * listens for it, signed with that endpoint's secret, and retried with backoff for 3 days.
 */

export const EVENT_TYPES = ['payment.succeeded', 'payment.failed', 'payment.canceled', 'refund.succeeded'] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

export const WebhookEndpoint = z.object({
  id: WebhookEndpointId,
  object: z.literal('webhook_endpoint'),
  livemode: Livemode,
  url: HttpsUrl,
  events: z.array(EventType).min(1),
  status: z.enum(['enabled', 'disabled']),
  /** `whsec_…`, for checking signatures. Returned once, when the endpoint is made. */
  secret: z.string().optional(),
  createdAt: Timestamp,
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpoint>;

/** `POST /v1/webhook_endpoints`, with the secret key. The endpoint's mode is the key's. */
export const CreateWebhookEndpoint = z.strictObject({
  url: HttpsUrl,
  events: z.array(EventType).min(1),
});
export type CreateWebhookEndpoint = z.input<typeof CreateWebhookEndpoint>;

const EventBase = {
  id: EventId,
  object: z.literal('event'),
  createdAt: Timestamp,
  livemode: Livemode,
  /** The version the event's object is shaped by: the endpoint's key's pinned version. */
  apiVersion: z.enum(CLEAR_VERSIONS),
};

/** An event. `data` is the object itself: `event.data.reference` is the payment's reference. */
export const Event = z.discriminatedUnion('type', [
  z.object({ ...EventBase, type: z.literal('payment.succeeded'), data: PaymentEventObject }),
  z.object({ ...EventBase, type: z.literal('payment.failed'), data: PaymentEventObject }),
  z.object({ ...EventBase, type: z.literal('payment.canceled'), data: PaymentEventObject }),
  z.object({ ...EventBase, type: z.literal('refund.succeeded'), data: Refund }),
]);
export type Event = z.infer<typeof Event>;

// ---- Deliveries (added in 2026-10-16, Phase 7) ---------------------------------------------------------

/**
 * One event sent to one endpoint: whether it got there, how many tries, and the endpoint's last answer.
 * `GET /v1/webhook_deliveries`, with the secret key, newest first. What Developers shows as "Recent
 * deliveries", for an agent (the MCP's `list_webhook_deliveries`) or a shop's own tooling.
 */
export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export const WebhookDelivery = z.object({
  id: WebhookDeliveryId,
  object: z.literal('webhook_delivery'),
  livemode: Livemode,
  endpoint: WebhookEndpointId,
  event: z.object({ id: EventId, type: EventType }),
  /** `pending` while it's still being retried (for 3 days); then `succeeded` or `failed`. */
  status: z.enum(WEBHOOK_DELIVERY_STATUSES),
  attempts: z.number().int().min(0),
  /** The HTTP status the endpoint last answered with; null before the first try, or when it didn't answer. */
  responseStatus: z.number().int().nullable(),
  lastAttemptAt: Timestamp.nullable(),
  nextAttemptAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

/** `GET /v1/webhook_deliveries`: one endpoint's, or one status, or all; the key's mode only. */
export const ListWebhookDeliveries = z.strictObject({
  endpoint: WebhookEndpointId.optional(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  startingAfter: WebhookDeliveryId.optional(),
});
export type ListWebhookDeliveries = z.input<typeof ListWebhookDeliveries>;

// ---- Signing ---------------------------------------------------------------------------------------

/**
 * `Clear-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, keyed with the
 * endpoint's secret. While a secret is being rolled, a delivery carries one `v1=` per live secret.
 * A receiver accepts any matching `v1` and refuses a `t` more than five minutes from its own clock.
 */
export const SIGNATURE_HEADER = 'Clear-Signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export const signedPayload = (timestamp: number, rawBody: string) => `${timestamp}.${rawBody}`;

export const formatSignatureHeader = (timestamp: number, signatures: string[]) =>
  [`t=${timestamp}`, ...signatures.map((s) => `v1=${s}`)].join(',');

/** The header's parts, or null when it isn't one. */
export function parseSignatureHeader(header: string | null | undefined): { timestamp: number; signatures: string[] } | null {
  if (!header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't' && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  return timestamp !== null && signatures.length ? { timestamp, signatures } : null;
}

/** Whether a signature's time is within the tolerance of `now` (unix seconds). */
export const timestampFresh = (timestamp: number, now: number) => Math.abs(now - timestamp) <= SIGNATURE_TOLERANCE_SECONDS;
