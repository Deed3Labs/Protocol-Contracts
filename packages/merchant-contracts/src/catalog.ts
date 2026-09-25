import { z } from 'zod';
import { Cents, Id, NonNegativeCents, ShopId, Timestamp } from './common';

/**
 * Items, their options, stock and discount codes.
 *
 * Stock is derived from movements: on hand, held and free are sums, never a number someone edits
 * without leaving a movement behind.
 */

export const TAX_KINDS = ['goods', 'labour', 'food', 'exempt'] as const;
/** Each maps to a Stripe tax code on the server. */
export const TaxKind = z.enum(TAX_KINDS);
export type TaxKind = z.infer<typeof TaxKind>;

export const Option = z.object({
  id: Id,
  name: z.string().min(1),
  /** The price change, which may be negative. */
  deltaCents: Cents,
  position: z.number().int().min(0),
});
export type Option = z.infer<typeof Option>;

export const OptionGroup = z.object({
  id: Id,
  name: z.string().min(1),
  /** Pick one, or pick any. */
  rule: z.enum(['one', 'any']),
  required: z.boolean(),
  position: z.number().int().min(0),
  options: z.array(Option),
});
export type OptionGroup = z.infer<typeof OptionGroup>;

export const StockLevel = z.object({
  onHand: z.number().int(),
  held: z.number().int().min(0),
  /** onHand − held. What can be sold. */
  free: z.number().int(),
});
export type StockLevel = z.infer<typeof StockLevel>;

export const CatalogItem = z.object({
  id: Id,
  shop: ShopId,
  name: z.string().min(1),
  detail: z.string().nullable(),
  category: z.string().min(1),
  priceCents: NonNegativeCents,
  /** What the shop pays. Owners and managers only; absent for a counter shift. */
  costCents: NonNegativeCents.nullable().optional(),
  taxKind: TaxKind,
  stockTracked: z.boolean(),
  /** Null for services, and for stock nobody reorders. */
  stock: StockLevel.nullable(),
  reorderAt: z.number().int().min(0).nullable(),
  optionGroups: z.array(OptionGroup),
  archivedAt: Timestamp.nullable(),
});
export type CatalogItem = z.infer<typeof CatalogItem>;

export const ItemInput = CatalogItem.pick({
  name: true,
  detail: true,
  category: true,
  priceCents: true,
  taxKind: true,
  stockTracked: true,
  reorderAt: true,
}).extend({ costCents: NonNegativeCents.nullable() });
export type ItemInput = z.infer<typeof ItemInput>;

export const STOCK_MOVEMENT_KINDS = ['receive', 'count', 'damage', 'hold', 'release', 'sell', 'return'] as const;
export const StockMovementKind = z.enum(STOCK_MOVEMENT_KINDS);
export type StockMovementKind = z.infer<typeof StockMovementKind>;

/** A movement made by hand: receiving, counting, damage. Holds and sales come from orders. */
export const StockAdjustment = z.object({
  itemId: Id,
  kind: z.enum(['receive', 'count', 'damage', 'return']),
  /** Signed: +8 received, −1 damaged; a count is the difference it finds. */
  quantity: z.number().int().refine((n) => n !== 0, 'A movement moves something'),
  reason: z.string().max(200).nullable(),
});
export type StockAdjustment = z.infer<typeof StockAdjustment>;

export const Reorder = z.object({
  id: Id,
  itemId: Id,
  quantity: z.number().int().min(1),
  supplier: z.string().nullable(),
  expectedOn: z.iso.date().nullable(),
  receivedQuantity: z.number().int().min(0),
  status: z.enum(['open', 'partly_received', 'received', 'cancelled']),
});
export type Reorder = z.infer<typeof Reorder>;

export const DiscountCode = z
  .object({
    id: Id,
    code: z.string().min(2).max(24),
    /** Exactly one of percent and amount. */
    percent: z.number().int().min(1).max(100).nullable(),
    amountCents: Cents.min(1).nullable(),
    /** Everything, or items in these categories. */
    appliesTo: z.union([z.object({ all: z.literal(true) }), z.object({ categories: z.array(z.string()).min(1) })]),
    startsAt: Timestamp.nullable(),
    endsAt: Timestamp.nullable(),
    oncePerCustomer: z.boolean(),
    uses: z.number().int().min(0),
  })
  .refine((d) => (d.percent === null) !== (d.amountCents === null), 'A code takes off a percent or an amount, not both');
export type DiscountCode = z.infer<typeof DiscountCode>;
