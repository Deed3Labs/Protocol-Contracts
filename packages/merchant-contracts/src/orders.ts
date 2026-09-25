import { z } from 'zod';
import { BusinessDate, Cents, Id, IdempotencyKey, NonNegativeCents, PositiveCents, ShopId, Timestamp } from './common';
import { TaxKind } from './catalog';

/**
 * Orders, their lines and their one discount; tenders and refunds.
 *
 * An order's figures are the server's: the app sends lines and a discount request, and gets back
 * the subtotal, discount, tax and total. Fees, tax and discount limits are never taken from the
 * client (principle 7).
 */

export const ORDER_STATUSES = ['open', 'paying', 'paid', 'voided', 'refunded', 'partly_refunded'] as const;
export const OrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const ChosenOption = z.object({
  groupId: Id,
  optionId: Id,
  /** A snapshot: the name and price as they were when the line was added. */
  name: z.string(),
  deltaCents: Cents,
});

export const OrderLine = z.object({
  id: Id,
  /** Null for a quick sale: a one-off amount, with a note and a tax kind, and no stock. */
  itemId: Id.nullable(),
  name: z.string().min(1),
  note: z.string().nullable(),
  quantity: z.number().int().min(1),
  /** Price with the chosen options. */
  unitCents: NonNegativeCents,
  options: z.array(ChosenOption),
  lineCents: NonNegativeCents,
  taxKind: TaxKind,
  taxCents: NonNegativeCents,
});
export type OrderLine = z.infer<typeof OrderLine>;

/** What the app sends: which item, how many, which options; or a quick sale. */
export const LineInput = z.union([
  z.object({
    itemId: Id,
    quantity: z.number().int().min(1),
    optionIds: z.array(Id),
  }),
  z.object({
    itemId: z.null(),
    name: z.string().min(1).max(80),
    note: z.string().max(200).nullable(),
    amountCents: PositiveCents,
    taxKind: TaxKind,
  }),
]);
export type LineInput = z.infer<typeof LineInput>;

export const OrderDiscount = z.object({
  kind: z.enum(['code', 'manual']),
  codeId: Id.nullable(),
  /** "FALL10 · 10% off", "15% · Returning customer" */
  label: z.string(),
  amountCents: NonNegativeCents,
  reason: z.string().nullable(),
  /** Set when the discount was over the applier's limit and someone approved it with a PIN. */
  approvedBy: Id.nullable(),
});
export type OrderDiscount = z.infer<typeof OrderDiscount>;

/** One per order: a code, or a manual percent or amount. Never both. */
export const DiscountRequest = z.union([
  z.object({ kind: z.literal('code'), code: z.string().min(1) }),
  z.object({
    kind: z.literal('manual'),
    percent: z.number().int().min(1).max(100).nullable(),
    amountCents: PositiveCents.nullable(),
    reason: z.string().min(1).max(200),
    /** Over the applier's limit: a manager's or owner's PIN. */
    approverPin: z.string().regex(/^\d{4}$/).nullable(),
  }),
]);
export type DiscountRequest = z.infer<typeof DiscountRequest>;

export const Order = z.object({
  id: Id,
  shop: ShopId,
  /** A number and a name for call-outs, where the shop uses them. */
  number: z.number().int().min(1).nullable(),
  name: z.string().nullable(),
  raisedBy: Id,
  customer: z.string().nullable(),
  status: OrderStatus,
  lines: z.array(OrderLine),
  discount: OrderDiscount.nullable(),
  subtotalCents: NonNegativeCents,
  discountCents: NonNegativeCents,
  taxCents: NonNegativeCents,
  /** subtotal − discount + tax. Tips ride on tenders, and are summed here for display. */
  totalCents: NonNegativeCents,
  tipCents: NonNegativeCents,
  /** What the tenders have not yet covered. */
  remainingCents: NonNegativeCents,
  businessDate: BusinessDate,
  createdAt: Timestamp,
});
export type Order = z.infer<typeof Order>;

export const TENDER_METHODS = ['clear', 'card', 'cash'] as const;
export const TenderMethod = z.enum(TENDER_METHODS);
export type TenderMethod = z.infer<typeof TenderMethod>;

export const TENDER_STATUSES = [
  'pending',
  'authorised',
  'approved',
  'declined',
  'captured',
  'cancelled',
  'refunded',
  'partly_refunded',
] as const;
export const TenderStatus = z.enum(TENDER_STATUSES);
export type TenderStatus = z.infer<typeof TenderStatus>;

export const Tender = z.object({
  id: Id,
  orderId: Id,
  method: TenderMethod,
  /** What this tender pays toward the order. */
  amountCents: PositiveCents,
  /** Added to this tender, on top of the amount. */
  tipCents: NonNegativeCents,
  status: TenderStatus,
  refundedCents: NonNegativeCents,
  /** Card: "visa", "4242". */
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  readerId: Id.nullable(),
  /** Clear: the charge code the member approves. */
  clearChargeCode: z.string().nullable(),
  /** Cash: handed over, and change given. */
  handedOverCents: NonNegativeCents.nullable(),
  changeCents: NonNegativeCents.nullable(),
  createdAt: Timestamp,
});
export type Tender = z.infer<typeof Tender>;

export const CreateCashTender = z.object({
  amountCents: PositiveCents,
  tipCents: NonNegativeCents,
  handedOverCents: PositiveCents,
  idempotencyKey: IdempotencyKey,
});

export const CreateClearTender = z.object({
  amountCents: PositiveCents,
  tipCents: NonNegativeCents,
  idempotencyKey: IdempotencyKey,
});

export const RefundItem = z.object({
  orderLineId: Id,
  quantity: z.number().int().min(1),
  /** Goods come back: back on the shelf, or not (damaged). Labour can't come back. */
  backInStock: z.boolean(),
});

export const Refund = z.object({
  id: Id,
  tenderId: Id,
  amountCents: PositiveCents,
  items: z.array(RefundItem),
  reason: z.string().nullable(),
  requestedBy: Id,
  approvedBy: Id.nullable(),
  status: z.enum(['requested', 'approved', 'declined', 'succeeded', 'failed']),
  createdAt: Timestamp,
});
export type Refund = z.infer<typeof Refund>;

export const RequestRefund = z.object({
  tenderId: Id,
  amountCents: PositiveCents,
  items: z.array(RefundItem),
  reason: z.string().max(200).nullable(),
  idempotencyKey: IdempotencyKey,
});
