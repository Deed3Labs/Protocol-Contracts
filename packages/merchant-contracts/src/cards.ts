import { z } from 'zod';
import { BusinessDate, Cents, Id, IdempotencyKey, NonNegativeCents, ShopId, Timestamp } from './common';

/**
 * Card processing: the connector, whether cards are available, readers, and card deposits.
 *
 * Providers come through a card-connector interface; Stripe is the first (card-processing prompt,
 * Phase 9). Nothing here says Stripe except the provider name.
 */

export const CardProvider = z.enum(['stripe']);

export const CardConnector = z.object({
  id: Id,
  shop: ShopId,
  provider: CardProvider,
  externalAccountId: z.string(),
  chargesEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
  /** Set when the merchant disconnects; history stays. */
  disconnectedAt: Timestamp.nullable(),
});
export type CardConnector = z.infer<typeof CardConnector>;

/**
 * The one flag the app reads: can this shop take a card right now. Settings, Checkout and the
 * Home + sheet show Card as locked or open from it. The reason is for the Settings copy.
 */
export const CardAvailability = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true) }),
  z.object({
    available: z.literal(false),
    reason: z.enum(['not_connected', 'details_pending', 'charges_disabled', 'disconnected']),
  }),
]);
export type CardAvailability = z.infer<typeof CardAvailability>;

export const ReaderType = z.enum(['m2', 'smart', 'tap_to_pay']);
export type ReaderType = z.infer<typeof ReaderType>;

export const Reader = z.object({
  id: Id,
  shop: ShopId,
  provider: CardProvider,
  type: ReaderType,
  externalReaderId: z.string(),
  label: z.string(),
  locationId: z.string().nullable(),
  lastSeenAt: Timestamp.nullable(),
});
export type Reader = z.infer<typeof Reader>;

/**
 * For the native Terminal SDK, made on the shop's connected account and scoped to its location.
 * `locationId` is the shop's reader location, which the SDK needs to connect an M2 or Tap to Pay.
 */
export const ConnectionToken = z.object({ secret: z.string(), locationId: z.string() });
export type ConnectionToken = z.infer<typeof ConnectionToken>;

/** A smart reader registered with the code it shows on screen. */
export const RegisterSmartReader = z.object({ registrationCode: z.string().min(1), label: z.string().min(1) });
/** An M2 or Tap to Pay reader the installed app has connected. */
export const RecordReader = z.object({
  type: z.enum(['m2', 'tap_to_pay']),
  externalReaderId: z.string().min(1),
  label: z.string().min(1),
});

/**
 * What the app needs to collect a card tender on the reader. The server creates the payment
 * (manual capture, Clear's fee as the application fee); the app collects it with the SDK.
 */
export const CardTenderStart = z.object({
  tenderId: Id,
  clientSecret: z.string(),
  /** Store-and-forward allowed for this one, and up to what. Null when not. */
  offlineLimitCents: NonNegativeCents.nullable(),
});
export type CardTenderStart = z.infer<typeof CardTenderStart>;

export const CreateCardTender = z.object({
  amountCents: Cents.min(1),
  tipCents: NonNegativeCents,
  readerId: Id,
  idempotencyKey: IdempotencyKey,
});

/**
 * A card deposit from the processor, and its "card processing" figure. The split between the
 * processor's fee and Clear's fee comes from the processor's fee data, never from our fee rule.
 */
export const CardDeposit = z.object({
  id: Id,
  shop: ShopId,
  externalPayoutId: z.string(),
  arrivalDate: BusinessDate,
  grossCents: Cents,
  processorFeeCents: NonNegativeCents,
  clearFeeCents: NonNegativeCents,
  /** gross − processor fee − Clear fee, as the processor paid it. */
  netCents: Cents,
  chargeCount: z.number().int().min(0),
  status: z.enum(['pending', 'in_transit', 'paid', 'failed']),
});
export type CardDeposit = z.infer<typeof CardDeposit>;
