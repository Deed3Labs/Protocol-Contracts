import { z } from 'zod';
import {
  Amount,
  Currency,
  Livemode,
  MAX_PAYMENT_AMOUNT,
  Metadata,
  MIN_PAYMENT_AMOUNT,
  NonNegativeAmount,
  PaymentId,
  PaymentMethod,
  PAYMENT_METHODS,
  Reference,
  Timestamp,
} from './common';

/**
 * A payment: the public view of one of the shop's orders, made online (rule 2). It has the order's
 * lines and total, the shop's reference, which ways it may be paid, and how far it has got. It never
 * carries a customer's name, contact, balance or credit terms, nor whether a Clear payment was split.
 */

export const PAYMENT_STATUSES = ['requires_customer', 'processing', 'succeeded', 'failed', 'canceled'] as const;
export const PaymentStatus = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const PaymentLine = z.object({
  name: z.string().min(1).max(80),
  /** Each, before tax. */
  amount: Amount,
  quantity: z.number().int().min(1).max(999),
});
export type PaymentLine = z.infer<typeof PaymentLine>;

export const Payment = z.object({
  id: PaymentId,
  object: z.literal('payment'),
  livemode: Livemode,
  /** What the customer pays, tax included. */
  amount: Amount,
  currency: Currency,
  lines: z.array(PaymentLine),
  /** The shop's own; null for a payment a price or a link started. */
  reference: Reference.nullable(),
  /** The ways this payment may be paid. Card is offered only when the shop's card processor is connected. */
  methods: z.array(PaymentMethod).min(1),
  status: PaymentStatus,
  /** How it was paid, once it was. */
  method: PaymentMethod.nullable(),
  /** Refunded so far. */
  amountRefunded: NonNegativeAmount,
  /**
   * Hands the payment to the script: `attach("#pay", { payment: clientSecret })`. Returned only to the
   * secret key, when it creates or reads the payment; never in a webhook or to a publishable key.
   */
  clientSecret: z.string().optional(),
  createdAt: Timestamp,
  succeededAt: Timestamp.nullable(),
  metadata: Metadata,
});
export type Payment = z.infer<typeof Payment>;

/** A payment as a webhook carries it: everything but the client secret. */
export const PaymentEventObject = Payment.omit({ clientSecret: true });
export type PaymentEventObject = z.infer<typeof PaymentEventObject>;

export const CreatePaymentLine = PaymentLine.extend({ quantity: PaymentLine.shape.quantity.default(1) });

/**
 * `POST /v1/payments`, with the secret key and an `Idempotency-Key`. The amount is the shop server's
 * and is never taken from a browser. `lines` describe the order; whatever `amount` comes to above the
 * lines (`amount − Σ amount × quantity`) is recorded as the tax the shop worked out. With no lines the
 * order has one line, "Payment", for the amount.
 */
export const CreatePayment = z
  .strictObject({
    /** Cents, tax included: from $0.50 to $999,999.99. */
    amount: z.number().int().safe(),
    currency: Currency,
    reference: Reference.optional(),
    lines: z.array(CreatePaymentLine).min(1).max(100).optional(),
    /** Both, unless the shop asks for one. */
    methods: z.array(PaymentMethod).min(1).default([...PAYMENT_METHODS]),
    metadata: Metadata.optional(),
  })
  .superRefine((p, ctx) => {
    if (p.amount < MIN_PAYMENT_AMOUNT) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'The least a payment can be is $0.50', params: { code: 'amount_too_small' } });
      return;
    }
    if (p.amount > MAX_PAYMENT_AMOUNT) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'That is more than a payment can be', params: { code: 'amount_too_large' } });
      return;
    }
    const lines = (p.lines ?? []).reduce((sum, l) => sum + l.amount * l.quantity, 0);
    if (lines > p.amount) {
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'The lines come to more than the amount', params: { code: 'lines_exceed_amount' } });
    }
  });
export type CreatePayment = z.input<typeof CreatePayment>;

/** `GET /v1/payments`: the shop's payments, newest first, optionally by reference or dates. */
export const ListPayments = z.strictObject({
  reference: Reference.optional(),
  createdFrom: Timestamp.optional(),
  createdTo: Timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  startingAfter: PaymentId.optional(),
});
