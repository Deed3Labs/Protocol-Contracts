import { createHmac, randomUUID } from 'node:crypto';
import { AddWebhookEndpoint, type MerchantWebhookEndpoint, type NewWebhookEndpoint, type WebhookDelivery } from '@clear/merchant-contracts';
import {
  CreateWebhookEndpoint,
  formatSignatureHeader,
  LATEST_VERSION,
  SIGNATURE_HEADER,
  signedPayload,
  type EventType,
  type WebhookEndpoint,
} from '@clear/public-api-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { audit } from '../security/audit.js';
import { PayError } from './links.js';
import { decryptSecret, encryptSecret, randomBase62 } from './secrets.js';

/**
 * Webhooks (pay spec §8): the shop's server learns what happened from a signed event, and fulfils
 * from it. An event is written in the same transaction as the change it describes, with one delivery
 * per endpoint that listens for it. A job sends them, signed with the endpoint's secret
 * (`Clear-Signature: t=…,v1=…`), and retries with backoff for 3 days. Each attempt is kept for
 * Developers' Recent deliveries.
 */

export const RETRY_FOR_MS = 3 * 24 * 3600_000;
/** Minutes after each failed attempt; the last repeats until the 3 days are up. */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 300, 600, 720];
const SEND_TIMEOUT_MS = 10_000;

interface EndpointRow {
  id: string;
  merchant: string;
  livemode: boolean;
  url: string;
  events: EventType[] | string;
  status: 'enabled' | 'disabled';
  secret_enc: string;
  created_by: string | null;
  created_at: Date | string;
  deleted_at: Date | string | null;
}

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
const events = (e: EndpointRow['events']): EventType[] => (typeof e === 'string' ? (e.replace(/^\{|\}$/g, '').split(',').filter(Boolean) as EventType[]) : e);

const toPublic = (r: EndpointRow): WebhookEndpoint => ({
  id: r.id,
  object: 'webhook_endpoint',
  livemode: r.livemode,
  url: r.url,
  events: events(r.events),
  status: r.deleted_at ? 'disabled' : r.status,
  createdAt: iso(r.created_at)!,
});

/**
 * A webhook URL Clear will post to: https, a public name. An address inside a network (localhost, a
 * `.internal` or `.local` name, an IP address) is refused, so an endpoint can't point Clear at itself.
 */
export function webhookUrlProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'That isn’t a web address';
  }
  if (u.protocol !== 'https:') return 'Webhooks go to https addresses only';
  const host = u.hostname.toLowerCase();
  if (u.username || u.password) return 'That isn’t a web address';
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'Use a public address';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) return 'Use the server’s name, not its IP address';
  if (!host.includes('.')) return 'Use a public address';
  return null;
}

async function insertEndpoint(db: Db, input: { merchant: string; livemode: boolean; url: string; events: EventType[]; staffId: string | null }): Promise<{ row: EndpointRow; secret: string }> {
  const problem = webhookUrlProblem(input.url);
  if (problem) throw new PayError(problem, 'invalid');
  const secret = `whsec_${randomBase62(32)}`;
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<EndpointRow>(
      `INSERT INTO payments.webhook_endpoints (id, merchant, livemode, url, events, secret_enc, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [`we_${randomUUID().replace(/-/g, '')}`, input.merchant, input.livemode, input.url, [...new Set(input.events)], encryptSecret(secret), input.staffId],
    );
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'webhook_endpoint.added', ref: { type: 'webhook_endpoint', id: rows[0]!.id }, detail: { url: input.url, livemode: input.livemode } });
    return { row: rows[0]!, secret };
  });
}

/** `POST /v1/webhook_endpoints`: the secret key's mode, the secret shown once. */
export async function createEndpointViaApi(db: Db, input: { merchant: string; livemode: boolean; request: unknown }): Promise<WebhookEndpoint> {
  const parsed = CreateWebhookEndpoint.parse(input.request);
  const { row, secret } = await insertEndpoint(db, { merchant: input.merchant, livemode: input.livemode, url: parsed.url, events: parsed.events, staffId: null });
  return { ...toPublic(row), secret };
}

export async function listEndpointsViaApi(q: Queryable, input: { merchant: string; livemode: boolean }): Promise<WebhookEndpoint[]> {
  const { rows } = await q.query<EndpointRow>('SELECT * FROM payments.webhook_endpoints WHERE merchant = $1 AND livemode = $2 AND deleted_at IS NULL ORDER BY created_at', [input.merchant, input.livemode]);
  return rows.map(toPublic);
}

/** Removed for good: nothing more is sent to it; what it was sent stays in the log. */
export async function deleteEndpoint(db: Db, input: { merchant: string; id: string; livemode?: boolean; staffId: string | null }): Promise<WebhookEndpoint> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<EndpointRow>(
      `UPDATE payments.webhook_endpoints SET deleted_at = COALESCE(deleted_at, now()), status = 'disabled'
        WHERE id = $1 AND merchant = $2 AND ($3::boolean IS NULL OR livemode = $3) RETURNING *`,
      [input.id, input.merchant, input.livemode ?? null],
    );
    if (!rows[0]) throw new PayError('No such webhook endpoint', 'not_found');
    // What was still waiting to go there won't.
    await tx.query(`UPDATE payments.webhook_deliveries SET status = 'failed', next_attempt_at = NULL WHERE endpoint_id = $1 AND status = 'pending'`, [input.id]);
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'webhook_endpoint.removed', ref: { type: 'webhook_endpoint', id: input.id } });
    return toPublic(rows[0]);
  });
}

// ---- Developers' view --------------------------------------------------------------------------------

export async function merchantEndpoints(q: Queryable, merchant: string): Promise<MerchantWebhookEndpoint[]> {
  const { rows } = await q.query<EndpointRow & { last_status: string | null }>(
    `SELECT e.*, (SELECT d.status FROM payments.webhook_deliveries d WHERE d.endpoint_id = e.id AND d.attempts > 0 ORDER BY d.last_attempt_at DESC LIMIT 1) AS last_status
       FROM payments.webhook_endpoints e WHERE e.merchant = $1 AND e.deleted_at IS NULL ORDER BY e.created_at`,
    [merchant],
  );
  return rows.map((r) => ({
    ...toPublic(r),
    health: r.status === 'disabled' ? 'disabled' : r.last_status === null ? 'new' : r.last_status === 'succeeded' ? 'healthy' : 'failing',
    createdBy: r.created_by,
  }));
}

/** Developers' "Add an endpoint". */
export async function addEndpointFromApp(db: Db, input: { merchant: string; staffId: string; request: unknown }): Promise<NewWebhookEndpoint> {
  const parsed = AddWebhookEndpoint.safeParse(input.request);
  if (!parsed.success) throw new PayError(parsed.error.issues[0]?.message ?? 'That endpoint isn’t valid', 'invalid');
  const { row, secret } = await insertEndpoint(db, { merchant: input.merchant, livemode: parsed.data.livemode, url: parsed.data.url, events: parsed.data.events, staffId: input.staffId });
  return { endpoint: { ...toPublic(row), health: 'new', createdBy: row.created_by }, secret };
}

/** Recent deliveries, the latest 20 per mode. */
export async function recentDeliveries(q: Queryable, merchant: string): Promise<WebhookDelivery[]> {
  const { rows } = await q.query<{
    id: string;
    endpoint_id: string;
    event_id: string;
    type: EventType;
    data: { reference?: string | null; id?: string; payment?: string } | string;
    status: WebhookDelivery['status'];
    attempts: number;
    response_code: number | null;
    last_attempt_at: Date | string | null;
    created_at: Date | string;
    next_attempt_at: Date | string | null;
    livemode: boolean;
    n: number;
  }>(
    `SELECT * FROM (
       SELECT d.*, e.type, e.data, e.livemode, row_number() OVER (PARTITION BY e.livemode ORDER BY COALESCE(d.last_attempt_at, d.created_at) DESC) AS n
         FROM payments.webhook_deliveries d JOIN payments.webhook_events e ON e.id = d.event_id
        WHERE e.merchant = $1) x
      WHERE n <= 20 ORDER BY COALESCE(last_attempt_at, created_at) DESC`,
    [merchant],
  );
  return rows.map((r) => {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    return {
      id: r.id,
      endpointId: r.endpoint_id,
      eventId: r.event_id,
      eventType: r.type,
      reference: data?.reference ?? data?.payment ?? data?.id ?? null,
      status: r.status,
      attempts: r.attempts,
      responseCode: r.response_code,
      at: iso(r.last_attempt_at ?? r.created_at)!,
      nextAttemptAt: iso(r.next_attempt_at),
    };
  });
}

// ---- Events --------------------------------------------------------------------------------------

/**
 * Writes an event, once (`dedupeKey`), with a delivery for every endpoint of the shop in that mode
 * listening for it. Call it inside the transaction that makes the change.
 */
export async function emitEvent(
  tx: Queryable,
  input: { merchant: string; livemode: boolean; type: EventType; data: Record<string, unknown>; dedupeKey: string; now?: Date },
): Promise<string | null> {
  const id = `evt_${randomUUID().replace(/-/g, '')}`;
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO payments.webhook_events (id, merchant, livemode, type, data, dedupe_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [id, input.merchant, input.livemode, input.type, JSON.stringify(input.data), input.dedupeKey, input.now ?? new Date()],
  );
  if (!rows[0]) return null;
  await tx.query(
    `INSERT INTO payments.webhook_deliveries (id, event_id, endpoint_id, next_attempt_at)
     SELECT 'whd_' || replace(gen_random_uuid()::text, '-', ''), $1, e.id, $4
       FROM payments.webhook_endpoints e
      WHERE e.merchant = $2 AND e.livemode = $3 AND e.status = 'enabled' AND e.deleted_at IS NULL AND $5 = ANY(e.events)`,
    [id, input.merchant, input.livemode, input.now ?? new Date(), input.type],
  );
  return id;
}

/** An event as it goes out: `data` is the object itself. */
export function eventBody(e: { id: string; type: string; created_at: Date | string; livemode: boolean; data: unknown }): string {
  const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
  return JSON.stringify({ id: e.id, object: 'event', type: e.type, createdAt: iso(e.created_at), livemode: e.livemode, apiVersion: LATEST_VERSION, data });
}

/** `Clear-Signature` for a body, with a secret. */
export function signBody(body: string, secret: string, timestamp: number): string {
  return formatSignatureHeader(timestamp, [createHmac('sha256', secret).update(signedPayload(timestamp, body)).digest('hex')]);
}

/** When to try again after `attempts` failures, or null once the 3 days are up. */
export function nextAttempt(createdAt: Date, attempts: number, now: Date): Date | null {
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]!;
  const next = new Date(now.getTime() + minutes * 60_000);
  return next.getTime() > createdAt.getTime() + RETRY_FOR_MS ? null : next;
}

export interface DeliverDeps {
  /** The job sends through `webhookSend` (webhookSend.ts), which refuses non-public addresses; tests stand in their own. */
  fetch: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: 'manual' }) => Promise<{ status: number }>;
  now?: () => Date;
}

/**
 * The delivery job: the deliveries that are due, each sent once. A delivery is leased for two minutes
 * before it's sent, so two workers never send the same one at once. Answers in 2xx are delivered;
 * anything else, or no answer in 10 seconds, is tried again later.
 */
export async function deliverDue(db: Db, deps: DeliverDeps, limit = 20): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const { rows } = await db.query<{
    id: string;
    attempts: number;
    created_at: Date | string;
    url: string;
    secret_enc: string;
    event_id: string;
    type: string;
    data: unknown;
    livemode: boolean;
    event_created_at: Date | string;
  }>(
    `WITH due AS (
       SELECT id FROM payments.webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= $1 ORDER BY next_attempt_at LIMIT $2 FOR UPDATE SKIP LOCKED
     )
     UPDATE payments.webhook_deliveries d SET next_attempt_at = $1::timestamptz + interval '2 minutes'
       FROM due, payments.webhook_endpoints e, payments.webhook_events v
      WHERE d.id = due.id AND e.id = d.endpoint_id AND v.id = d.event_id
     RETURNING d.id, d.attempts, d.created_at, e.url, e.secret_enc, v.id AS event_id, v.type, v.data, v.livemode, v.created_at AS event_created_at`,
    [now, limit],
  );
  for (const d of rows) {
    const body = eventBody({ id: d.event_id, type: d.type, created_at: d.event_created_at, livemode: d.livemode, data: d.data });
    let code: number | null = null;
    try {
      const res = await deps.fetch(d.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Clear-Webhooks/1',
          'Clear-Event-Id': d.event_id,
          [SIGNATURE_HEADER]: signBody(body, decryptSecret(d.secret_enc), Math.floor(now.getTime() / 1000)),
        },
        body,
      });
      code = res.status;
    } catch {
      code = null;
    }
    const attempts = d.attempts + 1;
    const ok = code !== null && code >= 200 && code < 300;
    const next = ok ? null : nextAttempt(new Date(d.created_at), attempts, now);
    await db.query(
      `UPDATE payments.webhook_deliveries SET attempts = $2, response_code = $3, last_attempt_at = $4, status = $5, next_attempt_at = $6 WHERE id = $1`,
      [d.id, attempts, code, now, ok ? 'succeeded' : next ? 'pending' : 'failed', next],
    );
  }
  return rows.length;
}
