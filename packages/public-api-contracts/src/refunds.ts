import { z } from 'zod';
import { Amount, Livemode, Note, PaymentId, RefundId, Timestamp } from './common';

/**
 * Refunds go through the shop's existing refund path. A card refund goes back through the shop's
 * card processor, in part or in full. A Clear refund is the whole payment (v1): it goes back to the
 * member's balance, or closes their plan. Asking for part of a Clear payment is refused with
 * `partial_refund_unsupported`; partial Clear refunds can come later as an addition.
 */
export const REFUND_STATUSES = [
  'pending_approval', // made by an agent (the MCP server): an owner or manager approves it in the merchant app
  'pending', // approved, and on its way
  'succeeded',
  'failed',
  'canceled', // declined, or withdrawn before it went
] as const;
export const RefundStatus = z.enum(REFUND_STATUSES);
export type RefundStatus = z.infer<typeof RefundStatus>;

export const Refund = z.object({
  id: RefundId,
  object: z.literal('refund'),
  livemode: Livemode,
  payment: PaymentId,
  amount: Amount,
  status: RefundStatus,
  reason: Note.nullable(),
  createdAt: Timestamp,
});
export type Refund = z.infer<typeof Refund>;

/**
 * `POST /v1/refunds`, with the secret key and an `Idempotency-Key`. With no `amount`, what's left of
 * the payment. A secret key's refund runs at once; `requireApproval` (the MCP server always sets it)
 * makes one that waits for an owner or manager.
 */
export const CreateRefund = z.strictObject({
  payment: PaymentId,
  amount: Amount.optional(),
  reason: Note.optional(),
  requireApproval: z.boolean().default(false),
});
export type CreateRefund = z.input<typeof CreateRefund>;
