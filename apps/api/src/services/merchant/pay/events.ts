import type { Payment, PaymentMethod, PaymentStatus, Refund } from '@clear/public-api-contracts';
import type { Queryable } from '../../../db/db.js';
import { decryptSecret, encryptSecret, randomBase62, sha256 } from './secrets.js';
import { emitEvent } from './webhooks.js';

/**
 * A payment as the public API and its webhooks show it (rule 2: a public view over an order), and the
 * events that go out as the order changes. Kept apart from the payment service so the order service's
 * `settleOrder` can call it without a cycle.
 */

export interface ApiPaymentRow {
  id: string;
  merchant: string;
  order_id: string;
  livemode: boolean;
  created_via: 'api' | 'link' | 'modal';
  key_id: string | null;
  reference: string | null;
  methods: PaymentMethod[] | string;
  metadata: Record<string, string> | string;
  client_secret_enc: string;
  request_hash: string | null;
  canceled_at: Date | string | null;
  created_at: Date | string;
}

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
const arr = (v: string[] | string): string[] => (typeof v === 'string' ? v.replace(/^\{|\}$/g, '').split(',').filter(Boolean) : v);
const TOOK = ['approved', 'captured', 'partly_refunded', 'refunded'];

interface TenderBits {
  id: string;
  method: 'clear' | 'card' | 'cash';
  status: string;
  amount_cents: string | number;
  refunded_cents: string | number;
  clear_charge_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Where a payment stands, from its order and tenders:
 * - canceled: the order was voided, or the payment canceled;
 * - succeeded: the order is paid (a refund later doesn't change that);
 * - processing: a tender is under way;
 * - failed: the latest tender was declined and nothing has started since;
 * - requires_customer: nothing has started.
 */
export function paymentStatus(input: { orderStatus: string; canceled: boolean; tenders: Pick<TenderBits, 'status' | 'created_at'>[] }): PaymentStatus {
  if (input.canceled || input.orderStatus === 'voided') return 'canceled';
  if (['paid', 'partly_refunded', 'refunded'].includes(input.orderStatus)) return 'succeeded';
  if (input.tenders.some((t) => t.status === 'pending' || t.status === 'authorised')) return 'processing';
  const latest = [...input.tenders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  return latest?.status === 'declined' ? 'failed' : 'requires_customer';
}

export async function paymentView(q: Queryable, row: ApiPaymentRow, opts: { secret?: boolean } = {}): Promise<Payment> {
  const { rows: orders } = await q.query<{ status: string; total_cents: string | number }>('SELECT status, total_cents FROM commerce.orders WHERE id = $1', [row.order_id]);
  const { rows: lines } = await q.query<{ name: string; unit_cents: string | number; quantity: number }>(
    'SELECT name, unit_cents, quantity FROM commerce.order_lines WHERE order_id = $1 AND removed_at IS NULL ORDER BY position, id',
    [row.order_id],
  );
  const { rows: tenders } = await q.query<TenderBits>(
    'SELECT id, method, status, amount_cents, refunded_cents, clear_charge_code, created_at, updated_at FROM payments.tenders WHERE order_id = $1 ORDER BY created_at, id',
    [row.order_id],
  );
  // Clear refunds don't touch the tender: they're settled against its charge.
  const codes = tenders.map((t) => t.clear_charge_code).filter((c): c is string => Boolean(c));
  // merchant.refunds is made the first time the Clear refund flow runs, so it may not be there yet.
  const clearRefunds = codes.length ? (await q.query<{ t: string | null }>(`SELECT to_regclass('merchant.refunds')::text AS t`)).rows[0]?.t : null;
  const clearRefunded = clearRefunds
    ? Number((await q.query<{ cents: string | number }>(`SELECT COALESCE(sum(amount_cents), 0) AS cents FROM merchant.refunds WHERE charge_code = ANY($1) AND state = 'settled'`, [codes])).rows[0]?.cents ?? 0)
    : 0;
  const order = orders[0]!;
  const status = paymentStatus({ orderStatus: order.status, canceled: row.canceled_at !== null, tenders });
  const took = tenders.filter((t) => TOOK.includes(t.status));
  const biggest = [...took].sort((a, b) => Number(b.amount_cents) - Number(a.amount_cents))[0];
  const method = status === 'succeeded' && biggest && biggest.method !== 'cash' ? biggest.method : null;
  const succeededAt = status === 'succeeded' && took.length ? iso(took.map((t) => t.updated_at).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]!) : null;
  const metadata = typeof row.metadata === 'string' ? (JSON.parse(row.metadata) as Record<string, string>) : row.metadata;
  return {
    id: row.id,
    object: 'payment',
    livemode: row.livemode,
    amount: Number(order.total_cents),
    currency: 'usd',
    lines: lines.map((l) => ({ name: l.name, amount: Number(l.unit_cents), quantity: l.quantity })),
    reference: row.reference,
    methods: arr(row.methods) as PaymentMethod[],
    status,
    method,
    amountRefunded: took.reduce((s, t) => s + Number(t.refunded_cents), 0) + clearRefunded,
    ...(opts.secret ? { clientSecret: decryptSecret(row.client_secret_enc) } : {}),
    createdAt: iso(row.created_at)!,
    succeededAt,
    metadata,
  };
}

/** The payment behind an order, if the order is one. */
export async function paymentForOrder(q: Queryable, orderId: string): Promise<ApiPaymentRow | null> {
  const { rows } = await q.query<ApiPaymentRow>('SELECT * FROM payments.api_payments WHERE order_id = $1', [orderId]);
  return rows[0] ?? null;
}

/**
 * The payment events an order's change makes, written in its transaction (called at the end of
 * `settleOrder`): succeeded once it's paid, canceled once it's voided, failed for each declined tender.
 * Each is written once, whatever retries the transaction.
 */
export async function paymentEvents(tx: Queryable, orderId: string): Promise<void> {
  const row = await paymentForOrder(tx, orderId);
  if (!row) return;
  const { clientSecret: _secret, ...view } = await paymentView(tx, row);
  const data = view as Record<string, unknown>;
  const base = { merchant: row.merchant, livemode: row.livemode, data };
  if (view.status === 'succeeded') await emitEvent(tx, { ...base, type: 'payment.succeeded', dedupeKey: `payment.succeeded:${row.id}` });
  if (view.status === 'canceled') await emitEvent(tx, { ...base, type: 'payment.canceled', dedupeKey: `payment.canceled:${row.id}` });
  const { rows: declined } = await tx.query<{ id: string }>(`SELECT id FROM payments.tenders WHERE order_id = $1 AND status = 'declined'`, [orderId]);
  for (const t of declined) await emitEvent(tx, { ...base, type: 'payment.failed', dedupeKey: `payment.failed:${t.id}` });
}

/** A refund's public id: the API's own, or one made from a refund asked for at the counter. */
export const publicRefundId = (rfdId: string) => `re_${rfdId.replace(/^rfd_/, '').replace(/[^A-Za-z0-9]/g, '')}`;

/**
 * `refund.succeeded` for a card or cash refund of an online payment, in the refund's transaction
 * (called where the refund is announced).
 */
export async function refundEvent(tx: Queryable, input: { refundId: string; orderId: string }): Promise<void> {
  const payment = await paymentForOrder(tx, input.orderId);
  if (!payment) return;
  const { rows } = await tx.query<{ amount_cents: string | number; reason: string | null; created_at: Date | string; api_id: string | null }>(
    `SELECT f.amount_cents, f.reason, f.created_at, a.id AS api_id FROM payments.refunds f LEFT JOIN payments.api_refunds a ON a.card_refund_id = f.id WHERE f.id = $1`,
    [input.refundId],
  );
  const r = rows[0];
  if (!r) return;
  const refund: Refund = {
    id: r.api_id ?? publicRefundId(input.refundId),
    object: 'refund',
    livemode: payment.livemode,
    payment: payment.id,
    amount: Number(r.amount_cents),
    status: 'succeeded',
    reason: r.reason,
    createdAt: iso(r.created_at)!,
  };
  await emitEvent(tx, { merchant: payment.merchant, livemode: payment.livemode, type: 'refund.succeeded', data: refund as unknown as Record<string, unknown>, dedupeKey: `refund.succeeded:${input.refundId}` });
}

/**
 * The payment behind an online or link order: its id, client secret (encrypted to give back, hashed
 * to find), and what the shop said about it. Every such order has one, so a link's sales are
 * payments too: listed, retrievable and in webhooks.
 */
export async function insertApiPayment(
  q: Queryable,
  input: {
    merchant: string;
    orderId: string;
    livemode: boolean;
    via: ApiPaymentRow['created_via'];
    keyId?: string | null;
    reference?: string | null;
    methods: PaymentMethod[];
    metadata?: Record<string, string>;
    idempotencyKey?: string | null;
    requestHash?: string | null;
    now?: Date;
  },
): Promise<ApiPaymentRow> {
  const id = `pay_${randomBase62(24)}`;
  const secret = `${id}_secret_${randomBase62(24)}`;
  const { rows } = await q.query<ApiPaymentRow>(
    `INSERT INTO payments.api_payments (id, merchant, order_id, livemode, created_via, key_id, reference, methods, metadata, client_secret_hash, client_secret_enc, idempotency_key, request_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      id,
      input.merchant,
      input.orderId,
      input.livemode,
      input.via,
      input.keyId ?? null,
      input.reference ?? null,
      input.methods,
      JSON.stringify(input.metadata ?? {}),
      sha256(secret),
      encryptSecret(secret),
      input.idempotencyKey ?? null,
      input.requestHash ?? null,
      input.now ?? new Date(),
    ],
  );
  return rows[0]!;
}
