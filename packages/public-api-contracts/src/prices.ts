import { z } from 'zod';
import { Amount, Livemode, MIN_PAYMENT_AMOUNT, Note, PaymentLinkId, PriceId, Timestamp, HttpsUrl } from './common';

/**
 * Prices and payment links.
 *
 * A price is a read-only view of one of the shop's Inventory items, so a page with no server can name
 * what it sells and the amount still comes from the merchant app. Its `amount` is before tax; the
 * payment adds the shop's tax. Items with options to choose aren't prices.
 */
export const MAX_QUANTITY = 99;

export const Price = z.object({
  id: PriceId,
  object: z.literal('price'),
  name: z.string(),
  /** Each, before tax. */
  amount: Amount,
  /** Archived in Inventory, or out of stock: a page can't start a payment for it. */
  active: z.boolean(),
  /** Whether the customer may buy more than one (up to `MAX_QUANTITY`). */
  allowQuantity: z.boolean(),
});
export type Price = z.infer<typeof Price>;

export const Quantity = z.number().int().min(1).max(MAX_QUANTITY);

/**
 * A payment link: a stored payment the shop can text, email or print. It opens at
 * `pay.useclear.org/l/:slug` as the modal's steps on a full page. It is either an amount, or a price
 * and a quantity; each time it's paid, it makes a new payment.
 */
export const PaymentLink = z.object({
  id: PaymentLinkId,
  object: z.literal('payment_link'),
  livemode: Livemode,
  url: HttpsUrl,
  slug: z.string(),
  /** Set for an amount link, tax included; null for a price link. */
  amount: Amount.nullable(),
  /** Set for a price link, with its quantity; null for an amount link. */
  price: PriceId.nullable(),
  quantity: Quantity.nullable(),
  note: Note.nullable(),
  expiresAt: Timestamp.nullable(),
  /** Members may choose to pay over time, where the shop offers it. */
  allowOverTime: z.boolean(),
  active: z.boolean(),
  createdAt: Timestamp,
});
export type PaymentLink = z.infer<typeof PaymentLink>;

const LinkOptions = {
  note: Note.optional(),
  expiresAt: Timestamp.optional(),
  allowOverTime: z.boolean().default(false),
};

/** `POST /v1/payment_links`, with the secret key: an amount, or a price and a quantity. */
export const CreatePaymentLink = z.union([
  z.strictObject({ amount: Amount.min(MIN_PAYMENT_AMOUNT), ...LinkOptions }),
  z.strictObject({ price: PriceId, quantity: Quantity.default(1), ...LinkOptions }),
]);
export type CreatePaymentLink = z.input<typeof CreatePaymentLink>;
