import { randomUUID } from 'node:crypto';
import {
  apiError,
  CreateModalSession,
  CreatePayment,
  CreatePaymentLink,
  CreateRefund,
  ERROR_CODES,
  fromZodError,
  ListPayments,
  ListWebhookDeliveries,
  type ApiError,
  type ErrorCode,
  type ModalSession,
  type Payment,
  type PaymentLink,
  type PaymentMethod,
  type Price,
  type Refund,
  type WebhookDelivery,
} from '@clear/public-api-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { createOrder, type OrderDeps } from '../orders/orderService.js';
import { discardOrder, PaymentError } from '../orders/payments.js';
import { approveApiRefund, RefundError, requestRefund, type RefundDeps } from '../orders/refunds.js';
import { insertApiPayment, paymentView, publicRefundId, type ApiPaymentRow } from './events.js';
import type { KeyAuth } from './keys.js';
import { cardsOn, type LinkRow, makeLink, payBase, PayError } from './links.js';
import { sha256 } from './secrets.js';

/**
 * The public API, `/v1` (pay spec §8): a public view over the shop's orders, never a second ledger
 * (rule 2). A payment is an online order and its tenders; a refund goes through the existing refund
 * path; a price is an Inventory item; a link is the merchant app's link. Everything is scoped to the
 * key's shop and mode, so a test key never sees a live payment, nor the reverse (rule 11).
 */

export class V1Error extends Error {
  readonly error: ApiError;
  constructor(code: ErrorCode, message: string, param?: string) {
    super(message);
    this.error = apiError(code, message, param);
  }
  get status() {
    return ERROR_CODES[this.error.code].status;
  }
}

export interface V1Deps {
  orders: OrderDeps;
  refunds: (merchant: string) => Promise<RefundDeps>;
}

const parse = <T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: unknown } }, body: unknown): T => {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const e = fromZodError(r.error as never);
    throw new V1Error(e.code, e.message, e.param);
  }
  return r.data;
};

/** A request's body as a stable string: the same payment asked for twice hashes the same. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
const requestHash = (body: unknown) => sha256(canonical(body));
const uniqueViolation = (e: unknown, index: string) => (e as { code?: string })?.code === '23505' && String((e as Error).message ?? '').includes(index);

// ---- Payments --------------------------------------------------------------------------------------

async function paymentRow(q: Queryable, auth: KeyAuth, id: string): Promise<ApiPaymentRow> {
  const { rows } = await q.query<ApiPaymentRow>('SELECT * FROM payments.api_payments WHERE id = $1 AND merchant = $2 AND livemode = $3', [id, auth.merchant, auth.livemode]);
  if (!rows[0]) throw new V1Error('payment_not_found', `No payment ${id}`, 'id');
  return rows[0];
}

async function byIdempotencyKey(q: Queryable, auth: KeyAuth, key: string): Promise<ApiPaymentRow | null> {
  const { rows } = await q.query<ApiPaymentRow>('SELECT * FROM payments.api_payments WHERE merchant = $1 AND livemode = $2 AND idempotency_key = $3', [auth.merchant, auth.livemode, key]);
  return rows[0] ?? null;
}

/** The ways this shop can be paid: card only with its processor connected. */
async function methodsFor(q: Queryable, merchant: string, asked: PaymentMethod[]): Promise<PaymentMethod[]> {
  const card = await cardsOn(q, merchant);
  return asked.filter((m) => m === 'clear' || card);
}

/**
 * `POST /v1/payments` (secret key, `Idempotency-Key`): the shop server's amount and lines, as an order
 * with nobody at the shop behind it. The same key and body again is the same payment; the same key with
 * another body is refused.
 */
export async function createPayment(db: Db, deps: V1Deps, input: { auth: KeyAuth; body: unknown; idempotencyKey: string; now?: Date }): Promise<Payment> {
  const p = parse(CreatePayment, input.body);
  const hash = requestHash(p);
  const again = await byIdempotencyKey(db, input.auth, input.idempotencyKey);
  if (again) {
    if (again.request_hash !== hash) throw new V1Error('idempotency_key_reused', 'That Idempotency-Key was used with a different request');
    return paymentView(db, again, { secret: true });
  }
  if (p.reference) {
    const { rows } = await db.query('SELECT 1 FROM payments.api_payments WHERE merchant = $1 AND livemode = $2 AND reference = $3', [input.auth.merchant, input.auth.livemode, p.reference]);
    if (rows[0]) throw new V1Error('reference_taken', `A payment already has the reference ${p.reference}`, 'reference');
  }
  const methods = await methodsFor(db, input.auth.merchant, p.methods);
  if (!methods.length) throw new V1Error('method_unavailable', 'This shop doesn’t take cards yet: connect a card processor in the merchant app, or allow Clear', 'methods');
  const lines = p.lines ?? [{ name: 'Payment', amount: p.amount, quantity: 1 }];
  const linesCents = lines.reduce((s, l) => s + l.amount * l.quantity, 0);
  const order = await createOrder(db, deps.orders, {
    merchant: input.auth.merchant,
    staffId: null,
    lines: [],
    customer: null,
    now: input.now,
    online: {
      source: 'online',
      detail: null,
      livemode: input.auth.livemode,
      given: { lines: lines.map((l) => ({ name: l.name, unitCents: l.amount, quantity: l.quantity })), taxCents: p.amount - linesCents },
    },
  });
  try {
    const row = await insertApiPayment(db, {
      merchant: input.auth.merchant,
      orderId: order.id,
      livemode: input.auth.livemode,
      via: 'api',
      keyId: input.auth.keyId,
      reference: p.reference ?? null,
      methods,
      metadata: p.metadata,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      now: input.now,
    });
    return paymentView(db, row, { secret: true });
  } catch (error) {
    // Two requests at once with the same key or reference: the first stands, this order goes.
    await discardOrder(db, { merchant: input.auth.merchant, orderId: order.id, staffId: null }).catch(() => undefined);
    if (uniqueViolation(error, 'api_payments_idempotency')) return createPayment(db, deps, input);
    if (uniqueViolation(error, 'api_payments_reference')) throw new V1Error('reference_taken', `A payment already has the reference ${p.reference}`, 'reference');
    throw error;
  }
}

export async function getPayment(db: Db, input: { auth: KeyAuth; id: string }): Promise<Payment> {
  return paymentView(db, await paymentRow(db, input.auth, input.id), { secret: input.auth.kind === 'secret' });
}

/** `GET /v1/payments`: newest first, by reference or dates, a page at a time. */
export async function listPayments(db: Db, input: { auth: KeyAuth; query: unknown }): Promise<{ object: 'list'; data: Payment[]; hasMore: boolean }> {
  const q = parse(ListPayments, input.query);
  let after: { created_at: Date | string; id: string } | null = null;
  if (q.startingAfter) after = await paymentRow(db, input.auth, q.startingAfter);
  const { rows } = await db.query<ApiPaymentRow>(
    `SELECT * FROM payments.api_payments
      WHERE merchant = $1 AND livemode = $2
        AND ($3::text IS NULL OR reference = $3)
        AND ($4::timestamptz IS NULL OR created_at >= $4)
        AND ($5::timestamptz IS NULL OR created_at <= $5)
        AND ($6::timestamptz IS NULL OR (created_at, id) < ($6::timestamptz, $7))
      ORDER BY created_at DESC, id DESC LIMIT $8`,
    [input.auth.merchant, input.auth.livemode, q.reference ?? null, q.createdFrom ?? null, q.createdTo ?? null, after ? after.created_at : null, after?.id ?? null, q.limit + 1],
  );
  const page = rows.slice(0, q.limit);
  const data: Payment[] = [];
  for (const r of page) data.push(await paymentView(db, r));
  return { object: 'list', data, hasMore: rows.length > q.limit };
}

/**
 * `GET /v1/webhook_deliveries` (secret key): each event sent to each endpoint, newest first, in the key's
 * mode. One endpoint's, or one status, when asked.
 */
export async function listDeliveries(db: Db, input: { auth: KeyAuth; query: unknown }): Promise<{ object: 'list'; data: WebhookDelivery[]; hasMore: boolean }> {
  const q = parse(ListWebhookDeliveries, input.query);
  const { rows } = await db.query<{
    id: string;
    endpoint_id: string;
    event_id: string;
    type: WebhookDelivery['event']['type'];
    livemode: boolean;
    status: WebhookDelivery['status'];
    attempts: number;
    response_code: number | null;
    last_attempt_at: Date | string | null;
    next_attempt_at: Date | string | null;
    created_at: Date | string;
  }>(
    `SELECT d.id, d.endpoint_id, d.event_id, e.type, e.livemode, d.status, d.attempts, d.response_code, d.last_attempt_at, d.next_attempt_at, d.created_at
       FROM payments.webhook_deliveries d JOIN payments.webhook_events e ON e.id = d.event_id
      WHERE e.merchant = $1 AND e.livemode = $2
        AND ($3::text IS NULL OR d.endpoint_id = $3)
        AND ($4::text IS NULL OR d.status = $4)
        AND ($5::text IS NULL OR (d.created_at, d.id) < (SELECT created_at, id FROM payments.webhook_deliveries WHERE id = $5))
      ORDER BY d.created_at DESC, d.id DESC LIMIT $6`,
    [input.auth.merchant, input.auth.livemode, q.endpoint ?? null, q.status ?? null, q.startingAfter ?? null, q.limit + 1],
  );
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  const data = rows.slice(0, q.limit).map((r) => ({
    id: r.id,
    object: 'webhook_delivery' as const,
    livemode: r.livemode,
    endpoint: r.endpoint_id,
    event: { id: r.event_id, type: r.type },
    status: r.status,
    attempts: r.attempts,
    responseStatus: r.response_code,
    lastAttemptAt: iso(r.last_attempt_at),
    nextAttemptAt: iso(r.next_attempt_at),
    createdAt: iso(r.created_at)!,
  }));
  return { object: 'list', data, hasMore: rows.length > q.limit };
}

/** `POST /v1/payments/:id/cancel`: only before anything is under way; a paid one is refunded instead. */
export async function cancelPayment(db: Db, input: { auth: KeyAuth; id: string }): Promise<Payment> {
  const row = await paymentRow(db, input.auth, input.id);
  const view = await paymentView(db, row);
  if (view.status === 'canceled') return view;
  if (view.status === 'succeeded') throw new V1Error('payment_not_cancelable', 'A payment that succeeded is refunded, not canceled');
  if (view.status === 'processing') throw new V1Error('payment_not_cancelable', 'This payment is under way; it can be canceled if it fails');
  await db.query('UPDATE payments.api_payments SET canceled_at = COALESCE(canceled_at, now()) WHERE id = $1', [row.id]);
  await discardOrder(db, { merchant: row.merchant, orderId: row.order_id, staffId: null }).catch((error) => {
    if (error instanceof PaymentError) throw new V1Error('payment_not_cancelable', error.message);
    throw error;
  });
  return paymentView(db, await paymentRow(db, input.auth, input.id));
}

// ---- Prices --------------------------------------------------------------------------------------

/** A price's id is its item's: `itm_tray12` is `price_tray12`. */
export const priceIdOf = (itemId: string) => `price_${itemId.replace(/^itm_/, '').replace(/[^A-Za-z0-9]/g, '')}`;

interface ItemRow {
  id: string;
  name: string;
  price_cents: string | number;
  archived_at: unknown;
  stock_tracked: boolean;
  free: number | null;
  options_required: boolean;
}

async function priceItems(q: Queryable, merchant: string): Promise<ItemRow[]> {
  const { rows } = await q.query<ItemRow>(
    `SELECT i.id, i.name, i.price_cents, i.archived_at, i.stock_tracked, s.free,
            EXISTS (SELECT 1 FROM commerce.option_groups g WHERE g.item_id = i.id AND g.required) AS options_required
       FROM commerce.catalog_items i LEFT JOIN commerce.stock_levels s ON s.item_id = i.id
      WHERE i.merchant = $1 ORDER BY i.name`,
    [merchant],
  );
  return rows.filter((r) => !r.options_required);
}

const toPrice = (r: ItemRow): Price => ({
  id: priceIdOf(r.id),
  object: 'price',
  name: r.name,
  amount: Number(r.price_cents),
  active: !r.archived_at && (!r.stock_tracked || (r.free ?? 0) > 0),
  allowQuantity: true,
});

/** `GET /v1/prices`: the shop's items a page can sell, archived ones left out. */
export async function listPrices(db: Db, input: { auth: KeyAuth }): Promise<{ object: 'list'; data: Price[]; hasMore: false }> {
  const items = await priceItems(db, input.auth.merchant);
  return { object: 'list', data: items.filter((i) => !i.archived_at).map(toPrice), hasMore: false };
}

/** The item behind a price, or why it can't be sold. */
export async function itemForPrice(q: Queryable, merchant: string, priceId: string): Promise<{ itemId: string; price: Price }> {
  const item = (await priceItems(q, merchant)).find((i) => priceIdOf(i.id) === priceId);
  if (!item) throw new V1Error('price_not_found', `No price ${priceId}`, 'price');
  const price = toPrice(item);
  if (!price.active) throw new V1Error('price_inactive', `${item.name} isn’t for sale right now`, 'price');
  return { itemId: item.id, price };
}

// ---- Payment links -------------------------------------------------------------------------------

export function publicLink(r: LinkRow, now = new Date()): PaymentLink {
  return {
    id: r.id,
    object: 'payment_link',
    livemode: r.livemode,
    url: `${payBase()}/l/${r.slug}`,
    slug: r.slug,
    amount: r.amount_cents === null ? null : Number(r.amount_cents),
    price: r.item_id ? priceIdOf(r.item_id) : null,
    quantity: r.quantity,
    note: r.note,
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    allowOverTime: r.allow_over_time,
    active: !r.deactivated_at && !(r.expires_at && new Date(r.expires_at).getTime() <= now.getTime()),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** `POST /v1/payment_links` (secret key): an amount, or a price and a quantity, in the key's mode. */
export async function createLinkV1(db: Db, input: { auth: KeyAuth; body: unknown; now?: Date }): Promise<PaymentLink> {
  const b = parse(CreatePaymentLink, input.body);
  const now = input.now ?? new Date();
  if (b.expiresAt && new Date(b.expiresAt).getTime() <= now.getTime()) throw new V1Error('parameter_invalid', 'A link expires in the future', 'expiresAt');
  const what = 'price' in b ? { itemId: (await itemForPrice(db, input.auth.merchant, b.price)).itemId, quantity: b.quantity } : { amountCents: b.amount };
  const row = await makeLink(db, {
    merchant: input.auth.merchant,
    staffId: null,
    livemode: input.auth.livemode,
    what,
    note: b.note ?? null,
    expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
    allowOverTime: b.allowOverTime,
    now,
  }).catch((error) => {
    if (error instanceof PayError) throw new V1Error('parameter_invalid', error.message, 'price');
    throw error;
  });
  return publicLink(row, now);
}

// ---- Refunds -------------------------------------------------------------------------------------

const REFUND_STATUS: Record<string, Refund['status']> = { requested: 'pending_approval', approved: 'pending', succeeded: 'succeeded', failed: 'failed', declined: 'canceled' };

async function refundView(q: Queryable, apiId: string): Promise<Refund> {
  const { rows } = await q.query<{ id: string; payment_id: string; livemode: boolean; amount_cents: string | number; reason: string | null; created_at: Date | string; status: string }>(
    `SELECT a.id, a.payment_id, a.livemode, a.amount_cents, a.reason, a.created_at, f.status
       FROM payments.api_refunds a JOIN payments.refunds f ON f.id = a.card_refund_id WHERE a.id = $1`,
    [apiId],
  );
  const r = rows[0]!;
  return { id: r.id, object: 'refund', livemode: r.livemode, payment: r.payment_id, amount: Number(r.amount_cents), status: REFUND_STATUS[r.status] ?? 'pending', reason: r.reason, createdAt: new Date(r.created_at).toISOString() };
}

/**
 * `POST /v1/refunds` (secret key, `Idempotency-Key`). A card payment, in part or in full, through the
 * shop's card processor: approved as it's asked, unless `requireApproval`, which leaves it for an owner
 * or manager in Charges. A Clear payment is refunded from Charges, where the owner approves it, so the
 * API refuses it (`refund_in_app`) and a part of one (`partial_refund_unsupported`).
 */
export async function createRefundV1(db: Db, deps: V1Deps, input: { auth: KeyAuth; body: unknown; idempotencyKey: string }): Promise<Refund> {
  const b = parse(CreateRefund, input.body);
  const hash = requestHash(b);
  const { rows: again } = await db.query<{ id: string; request_hash: string }>('SELECT id, request_hash FROM payments.api_refunds WHERE merchant = $1 AND livemode = $2 AND idempotency_key = $3', [
    input.auth.merchant,
    input.auth.livemode,
    input.idempotencyKey,
  ]);
  if (again[0]) {
    if (again[0].request_hash !== hash) throw new V1Error('idempotency_key_reused', 'That Idempotency-Key was used with a different request');
    return refundView(db, again[0].id);
  }
  const payment = await paymentRow(db, input.auth, b.payment);
  const view = await paymentView(db, payment);
  if (view.status !== 'succeeded') throw new V1Error('payment_not_refundable', 'Only a payment that succeeded is refunded', 'payment');
  const { rows: tenders } = await db.query<{ id: string; method: string; amount_cents: string | number; tip_cents: string | number; refunded_cents: string | number }>(
    `SELECT id, method, amount_cents, tip_cents, refunded_cents FROM payments.tenders WHERE order_id = $1 AND status IN ('approved','captured','partly_refunded') ORDER BY created_at`,
    [payment.order_id],
  );
  if (tenders.some((t) => t.method === 'clear')) {
    if (b.amount !== undefined && b.amount < view.amount) throw new V1Error('partial_refund_unsupported', 'A Clear payment is refunded in full', 'amount');
    throw new V1Error('refund_in_app', 'A Clear payment is refunded from Charges in the merchant app, where the owner approves it');
  }
  const card = tenders.find((t) => t.method === 'card');
  if (!card) throw new V1Error('payment_not_refundable', 'Nothing on this payment can be refunded through the API', 'payment');
  const { rows: waiting } = await db.query<{ cents: string | number }>(`SELECT COALESCE(sum(amount_cents), 0) AS cents FROM payments.refunds WHERE tender_id = $1 AND status IN ('requested','approved')`, [card.id]);
  const left = Number(card.amount_cents) + Number(card.tip_cents) - Number(card.refunded_cents) - Number(waiting[0]!.cents);
  const amount = b.amount ?? left;
  if (amount <= 0 || amount > left) throw new V1Error('refund_exceeds_payment', `At most ${left} cents can still be refunded on this payment`, 'amount');

  const refundDeps = await deps.refunds(input.auth.merchant);
  const asked = await requestRefund(db, refundDeps, {
    merchant: input.auth.merchant,
    staff: { id: null, role: 'owner' },
    viaApi: true,
    request: { tenderId: card.id, amountCents: amount, items: [], reason: b.reason ?? null, idempotencyKey: `api:${input.auth.livemode ? 'live' : 'test'}:${input.idempotencyKey}` },
  }).catch((error) => {
    if (error instanceof RefundError) throw new V1Error(error.code === 'over_amount' ? 'refund_exceeds_payment' : 'payment_not_refundable', error.message, 'amount');
    throw error;
  });
  const apiId = publicRefundId(asked.id);
  await db.query(
    `INSERT INTO payments.api_refunds (id, merchant, payment_id, livemode, amount_cents, reason, method, card_refund_id, require_approval, idempotency_key, request_hash)
     VALUES ($1,$2,$3,$4,$5,$6,'card',$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
    [apiId, input.auth.merchant, payment.id, input.auth.livemode, amount, b.reason ?? null, asked.id, b.requireApproval, input.idempotencyKey, hash],
  );
  if (!b.requireApproval) {
    await approveApiRefund(db, refundDeps, { merchant: input.auth.merchant, refundId: asked.id }).catch((error) => {
      // Asked and approved; the processor refused. The refund says failed, and the shop can try again.
      if (!(error instanceof RefundError)) throw error;
    });
  }
  return refundView(db, apiId);
}

// ---- The modal ---------------------------------------------------------------------------------------

export const MODAL_SESSION_MS = 30 * 60 * 1000;

/**
 * `POST /v1/modal_sessions` (publishable key, from an allowed website): what the frame opens. A price
 * session's order is made when the customer starts paying (Phase 5); a payment's is the payment's.
 */
export async function createModalSession(db: Db, input: { auth: KeyAuth; origin: string; body: unknown; now?: Date }): Promise<ModalSession> {
  const b = parse(CreateModalSession, input.body);
  const now = input.now ?? new Date();
  let orderId: string | null = null;
  let methods: PaymentMethod[] = ['clear', 'card'];
  const options: Record<string, unknown> = { accent: b.accent, logo: b.logo, locale: b.locale, email: b.email };
  if ('price' in b) {
    await itemForPrice(db, input.auth.merchant, b.price);
    options.price = b.price;
    options.quantity = b.quantity;
  } else {
    const { rows } = await db.query<ApiPaymentRow>('SELECT * FROM payments.api_payments WHERE client_secret_hash = $1 AND merchant = $2 AND livemode = $3', [
      sha256(b.payment),
      input.auth.merchant,
      input.auth.livemode,
    ]);
    if (!rows[0]) throw new V1Error('payment_not_found', 'No payment has that client secret', 'payment');
    const view = await paymentView(db, rows[0]);
    if (view.status === 'succeeded' || view.status === 'canceled') throw new V1Error('payment_closed', 'This payment has been paid or canceled', 'payment');
    orderId = rows[0].order_id;
    methods = view.methods;
    // The website it was opened from is where it came from (an order's source detail).
    await db.query(`UPDATE commerce.orders SET source_detail = COALESCE(source_detail, $2) WHERE id = $1`, [orderId, input.origin]);
  }
  options.methods = (b.methods ?? methods).filter((m) => methods.includes(m));
  const id = `ms_${randomUUID().replace(/-/g, '')}`;
  const expiresAt = new Date(now.getTime() + MODAL_SESSION_MS);
  await db.query(
    `INSERT INTO payments.pay_sessions (id, merchant, livemode, kind, order_id, origin, options, created_at, expires_at) VALUES ($1,$2,$3,'modal',$4,$5,$6,$7,$8)`,
    [id, input.auth.merchant, input.auth.livemode, orderId, input.origin, JSON.stringify(options), now, expiresAt],
  );
  return { id, object: 'modal_session', livemode: input.auth.livemode, url: `${payBase()}/m/${id}`, expiresAt: expiresAt.toISOString() };
}
