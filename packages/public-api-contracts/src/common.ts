import { z } from 'zod';

/**
 * Small types every public object uses. Money is integer cents in `usd`, as in the merchant API.
 * Ids are opaque strings with a prefix that says what they are. Times are ISO 8601 with a zone.
 */

/** Cents. `18532` is $185.32. */
export const Amount = z.number().int().safe().min(1);
export const NonNegativeAmount = z.number().int().safe().min(0);
/** The least a payment can be: Stripe's card minimum, so card is never refused for being too small. */
export const MIN_PAYMENT_AMOUNT = 50;
export const MAX_PAYMENT_AMOUNT = 99_999_999;

export const Currency = z.literal('usd');
export const Timestamp = z.iso.datetime({ offset: true });
/** Every payment, link, refund, webhook endpoint and event is either test or live, never both (rule 11). */
export const Livemode = z.boolean();

export const ID_PREFIXES = {
  payment: 'pay_',
  price: 'price_',
  paymentLink: 'plink_',
  refund: 're_',
  webhookEndpoint: 'we_',
  event: 'evt_',
  modalSession: 'ms_',
} as const;

const prefixed = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}[A-Za-z0-9]{1,64}$`), `Expected an id starting ${prefix}`);

export const PaymentId = prefixed(ID_PREFIXES.payment);
export const PriceId = prefixed(ID_PREFIXES.price);
export const PaymentLinkId = prefixed(ID_PREFIXES.paymentLink);
export const RefundId = prefixed(ID_PREFIXES.refund);
export const WebhookEndpointId = prefixed(ID_PREFIXES.webhookEndpoint);
export const EventId = prefixed(ID_PREFIXES.event);
export const ModalSessionId = prefixed(ID_PREFIXES.modalSession);

/** The shop's own string for a payment ("catering-1042"): unique per shop and mode. */
export const Reference = z.string().trim().min(1).max(100);

/** A line for the customer: "Saturday pickup, 11:30am". */
export const Note = z.string().trim().min(1).max(200);

/** Up to 20 keys of the shop's own; never shown to the customer. */
export const MAX_METADATA_KEYS = 20;
export const Metadata = z
  .record(z.string().min(1).max(40), z.string().max(500))
  .refine((m) => Object.keys(m).length <= MAX_METADATA_KEYS, `At most ${MAX_METADATA_KEYS} metadata keys`);

export const PAYMENT_METHODS = ['clear', 'card'] as const;
export const PaymentMethod = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

/** An https URL. The webhook endpoint and the logo must be one. */
export const HttpsUrl = z.url({ protocol: /^https$/ }).max(2048);

/** A page of a list, newest first. */
export const listOf = <T extends z.ZodType>(item: T) =>
  z.object({ object: z.literal('list'), data: z.array(item), hasMore: z.boolean() });

export const ListParams = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** An id from the previous page: the list continues after it. */
  startingAfter: z.string().optional(),
});
