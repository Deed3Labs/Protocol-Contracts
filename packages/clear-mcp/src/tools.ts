/**
 * The five tools, as plain functions over a Clear client: no MCP here, so they're tested without a
 * transport (server.ts does the wiring). Each answers a tool result; none throws. A refused request is
 * `isError: true` with Clear's `code` and `message`; anything else is a short generic message.
 */
import {
  MAX_PAYMENT_AMOUNT,
  MAX_QUANTITY,
  MIN_PAYMENT_AMOUNT,
  Note,
  PaymentId,
  PriceId,
  Timestamp,
  WEBHOOK_DELIVERY_STATUSES,
  WebhookEndpointId,
  type WebhookDelivery,
} from '@clear/public-api-contracts';
import {
  ClearError,
  type CreatePaymentLink,
  type CreateRefund,
  type List,
  type ListPaymentsParams,
  type ListWebhookDeliveriesParams,
  type Payment,
  type PaymentLink,
  type Refund,
  type RequestOptions,
} from '@useclear/node';
import { z } from 'zod';
import { formatUsd } from './money';

/** What the tools use of `new Clear(key)`. Structural, so a test can hand in its own. */
export interface ClearClient {
  payments: {
    retrieve(paymentId: string): Promise<Payment>;
    list(params?: ListPaymentsParams): Promise<List<Payment>>;
  };
  paymentLinks: { create(params: CreatePaymentLink, options?: RequestOptions): Promise<PaymentLink> };
  refunds: { create(params: CreateRefund, options?: RequestOptions): Promise<Refund> };
  webhookDeliveries: { list(params?: ListWebhookDeliveriesParams): Promise<List<WebhookDelivery>> };
}

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

const fail = (code: string, message: string, extra: { param?: string; requestId?: string } = {}): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: { code, message, ...extra } }, null, 2) }],
  isError: true,
});

export const REFUND_WAITING = "Waiting for an owner or manager to approve it in Clear's merchant app, under Charges.";
export const REFUND_IN_APP =
  "This is a Clear payment. A Clear payment is refunded from Charges in Clear's merchant app, where the owner approves it. Nothing was changed.";
const GENERIC_FAILURE = "Something went wrong running this tool, before Clear answered. Check the merchant app before trying again.";

/** A ClearError as Clear said it; anything else, generically (its text could carry anything). */
export function errorResult(err: unknown): ToolResult {
  if (err instanceof ClearError) {
    return fail(err.code, err.message, {
      ...(err.param ? { param: err.param } : {}),
      ...(err.requestId ? { requestId: err.requestId } : {}),
    });
  }
  return fail('tool_error', GENERIC_FAILURE);
}

const money = (cents: number) => ({ cents, formatted: formatUsd(cents) });

const paymentView = (p: Payment) => ({
  id: p.id,
  reference: p.reference,
  status: p.status,
  method: p.method,
  amount: money(p.amount),
  amountRefunded: money(p.amountRefunded),
  lines: p.lines.map((l) => ({ name: l.name, quantity: l.quantity, amountEach: money(l.amount) })),
  methods: p.methods,
  livemode: p.livemode,
  createdAt: p.createdAt,
  succeededAt: p.succeededAt,
  metadata: p.metadata,
  // clientSecret left out on purpose: it hands the payment to a checkout page, and an agent has no use for it.
});

// ---- create_payment_link ------------------------------------------------------------------------------

export const createPaymentLinkInput = {
  amount: z
    .number()
    .int()
    .min(MIN_PAYMENT_AMOUNT)
    .max(MAX_PAYMENT_AMOUNT)
    .optional()
    .describe('Cents, tax included: 18532 is $185.32. Give this or price, not both.'),
  price: PriceId.optional().describe('A price id (price_…) from Inventory in the merchant app, instead of an amount.'),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).optional().describe('With price only: how many. 1 unless you say.'),
  note: Note.optional().describe('A line the customer sees, like "Catering for Saturday, 12 people".'),
  expiresAt: Timestamp.optional().describe('When the link stops working: ISO 8601 with a zone, like 2026-10-31T23:59:00-07:00.'),
};
const CreatePaymentLinkInput = z.object(createPaymentLinkInput);

export async function createPaymentLink(clear: ClearClient, input: z.infer<typeof CreatePaymentLinkInput>): Promise<ToolResult> {
  const { amount, price, quantity, note, expiresAt } = input;
  if ((amount === undefined) === (price === undefined)) return fail('parameter_invalid', 'Give an amount (in cents) or a price, not both.');
  if (amount !== undefined && quantity !== undefined) return fail('parameter_invalid', 'quantity goes with a price, not an amount.', { param: 'quantity' });
  const options = { ...(note ? { note } : {}), ...(expiresAt ? { expiresAt } : {}) };
  const params: CreatePaymentLink = amount !== undefined ? { amount, ...options } : { price: price!, quantity: quantity ?? 1, ...options };
  try {
    const link = await clear.paymentLinks.create(params);
    return ok({
      id: link.id,
      url: link.url,
      // An amount link's amount is tax included; a price link's comes from the price, and the payment adds tax.
      amount: link.amount === null ? null : money(link.amount),
      price: link.price,
      quantity: link.quantity,
      note: link.note,
      expiresAt: link.expiresAt,
      livemode: link.livemode,
    });
  } catch (err) {
    return errorResult(err);
  }
}

// ---- get_payment --------------------------------------------------------------------------------------

export const getPaymentInput = {
  id: PaymentId.optional().describe('The payment id (pay_…). Give this or reference.'),
  reference: z.string().trim().min(1).max(100).optional().describe("The shop's own reference for the payment, like catering-1042."),
};
const GetPaymentInput = z.object(getPaymentInput);

export async function getPayment(clear: ClearClient, input: z.infer<typeof GetPaymentInput>): Promise<ToolResult> {
  const { id, reference } = input;
  if ((id === undefined) === (reference === undefined)) return fail('parameter_invalid', 'Give an id (pay_…) or a reference, not both.');
  try {
    if (id !== undefined) return ok(paymentView(await clear.payments.retrieve(id)));
    const page = await clear.payments.list({ reference, limit: 1 });
    const found = page.data[0];
    if (!found) return fail('payment_not_found', `No payment has the reference "${reference}" (in this key's mode, test or live).`, { param: 'reference' });
    return ok(paymentView(found));
  } catch (err) {
    return errorResult(err);
  }
}

// ---- list_payments ------------------------------------------------------------------------------------

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * A bare date is a whole UTC day: `from` its first millisecond, `to` its last (Clear's range is
 * inclusive at both ends). A datetime with no zone is read as UTC. Null when it isn't a date.
 */
export function toTimestamp(value: string, edge: 'from' | 'to'): string | null {
  const v = value.trim();
  if (BARE_DATE.test(v)) {
    const day = new Date(`${v}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== v) return null; // 2026-02-30
    return new Date(day.getTime() + (edge === 'to' ? DAY_MS - 1 : 0)).toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(v);
  const at = new Date(zoned ? v : `${v}Z`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export const listPaymentsInput = {
  from: z.string().optional().describe('Start: an ISO date (2026-10-15, from the start of that day in UTC) or datetime. Leave out for no start.'),
  to: z.string().optional().describe('End: an ISO date (to the end of that day in UTC) or datetime. Leave out for up to now. For one day, give the same date as from.'),
  limit: z.number().int().min(1).max(100).optional().describe('How many, newest first: 20 unless you say, at most 100.'),
};
const ListPaymentsInput = z.object(listPaymentsInput);

export async function listPayments(clear: ClearClient, input: z.infer<typeof ListPaymentsInput>): Promise<ToolResult> {
  const createdFrom = input.from === undefined ? undefined : toTimestamp(input.from, 'from');
  const createdTo = input.to === undefined ? undefined : toTimestamp(input.to, 'to');
  if (createdFrom === null) return fail('parameter_invalid', 'from is not a date (2026-10-15) or a datetime (2026-10-15T09:00:00-07:00).', { param: 'from' });
  if (createdTo === null) return fail('parameter_invalid', 'to is not a date (2026-10-15) or a datetime (2026-10-15T17:00:00-07:00).', { param: 'to' });
  if (createdFrom && createdTo && createdFrom > createdTo) return fail('parameter_invalid', 'from is after to.', { param: 'from' });
  try {
    const page = await clear.payments.list({
      ...(createdFrom ? { createdFrom } : {}),
      ...(createdTo ? { createdTo } : {}),
      limit: input.limit ?? 20,
    });
    return ok({
      from: createdFrom ?? null,
      to: createdTo ?? null,
      payments: page.data.map((p) => ({
        id: p.id,
        reference: p.reference,
        amount: money(p.amount),
        status: p.status,
        method: p.method,
        createdAt: p.createdAt,
      })),
      // More payments match than this page holds: narrow the range, or raise limit (up to 100).
      hasMore: page.hasMore,
    });
  } catch (err) {
    return errorResult(err);
  }
}

// ---- refund_payment -----------------------------------------------------------------------------------

export const refundPaymentInput = {
  payment: PaymentId.describe('The payment id (pay_…) to refund.'),
  amount: z.number().int().min(1).optional().describe("Cents, for part of a card payment. Leave out for what's left of the payment."),
  reason: Note.optional().describe('Why, for the owner or manager who approves it.'),
};
const RefundPaymentInput = z.object(refundPaymentInput);

/** Never refunds by itself: every refund it asks for waits for an owner or manager in the merchant app. */
export async function refundPayment(clear: ClearClient, input: z.infer<typeof RefundPaymentInput>): Promise<ToolResult> {
  const { payment, amount, reason } = input;
  try {
    // No idempotency key of ours: the SDK makes one per call and reuses it across that call's retries,
    // which is what's wanted. A key derived from payment + amount would turn a second, deliberate refund
    // of the same amount into the first one coming back; and a duplicate made by an agent calling twice
    // only waits in Charges, where the owner or manager sees it and declines it.
    const refund = await clear.refunds.create({
      payment,
      ...(amount !== undefined ? { amount } : {}),
      ...(reason ? { reason } : {}),
      requireApproval: true,
    });
    return ok({
      refund: { id: refund.id, payment: refund.payment, amount: money(refund.amount), status: refund.status, reason: refund.reason },
      message: refund.status === 'pending_approval' ? REFUND_WAITING : `Clear says this refund is ${refund.status}.`,
    });
  } catch (err) {
    if (err instanceof ClearError && err.code === 'refund_in_app') return fail('refund_in_app', REFUND_IN_APP);
    return errorResult(err);
  }
}

// ---- list_webhook_deliveries --------------------------------------------------------------------------

export const listWebhookDeliveriesInput = {
  endpoint: WebhookEndpointId.optional().describe("One webhook endpoint's (we_…). Leave out for every endpoint."),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional().describe('pending (still being retried), succeeded or failed (gave up after 3 days).'),
  limit: z.number().int().min(1).max(100).optional().describe('How many, newest first: 20 unless you say, at most 100.'),
};
const ListWebhookDeliveriesInput = z.object(listWebhookDeliveriesInput);

export async function listWebhookDeliveries(clear: ClearClient, input: z.infer<typeof ListWebhookDeliveriesInput>): Promise<ToolResult> {
  try {
    const page = await clear.webhookDeliveries.list({
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      ...(input.status ? { status: input.status } : {}),
      limit: input.limit ?? 20,
    });
    return ok({
      deliveries: page.data.map((d) => ({
        id: d.id,
        endpoint: d.endpoint,
        eventType: d.event.type,
        eventId: d.event.id,
        status: d.status,
        attempts: d.attempts,
        lastHttpStatus: d.responseStatus,
        lastAttemptAt: d.lastAttemptAt,
        nextAttemptAt: d.nextAttemptAt,
        createdAt: d.createdAt,
      })),
      hasMore: page.hasMore,
    });
  } catch (err) {
    return errorResult(err);
  }
}
