import { z } from 'zod';
import { Id, NonNegativeCents, Role, ShopId, Timestamp } from './common';

/**
 * A shop, its settings and its people.
 *
 * The shop row is `merchant.profiles`, keyed by the shop's wallet address (HARD STOP 1).
 */

export const Address = z.object({
  line1: z.string().min(1),
  line2: z.string().nullable(),
  city: z.string().min(1),
  /** State or region: `CA`. */
  region: z.string().min(1),
  postalCode: z.string().min(1),
  /** ISO 3166-1 alpha-2. */
  country: z.string().length(2),
});
export type Address = z.infer<typeof Address>;

/** The card plan decides Clear's fee on a card sale (see `clearCardFee`). */
export const CardPlan = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('payg') }),
  z.object({ kind: z.literal('paid'), feeCents: NonNegativeCents }),
]);
export type CardPlan = z.infer<typeof CardPlan>;

/**
 * What Clear charges on Clear credit, by how the member pays. For display: what a Clear charge
 * actually settles at is read from the on-chain merchant registry, which stays the source of truth
 * (HARD STOP 1). Basis points: 125 is 1.25%.
 */
export const ClearTier = z.object({
  tier: z.enum(['founding', 'standard']),
  paidNowBps: z.number().int().min(0),
  overTimeBps: z.number().int().min(0),
});
export type ClearTier = z.infer<typeof ClearTier>;

export const Shop = z.object({
  id: ShopId,
  name: z.string().min(1),
  /** Sets the sales tax. Null until the shop enters it. */
  address: Address.nullable(),
  /** IANA: `America/Los_Angeles`. Business dates and day reports use it. */
  timezone: z.string().min(1),
  currency: z.literal('usd'),
  cardPlan: CardPlan,
  clearTier: ClearTier,
});
export type Shop = z.infer<typeof Shop>;

/** What an owner can change about the shop: where it is (which sets sales tax and the reader location) and its timezone. */
export const ShopPatch = z
  .object({
    address: Address,
    timezone: z.string().min(1),
  })
  .partial();
export type ShopPatch = z.infer<typeof ShopPatch>;

/**
 * Where a shop's sales tax comes from (Settings › Tax). The shop is liable, so tax is worked out on
 * its own Stripe account once Stripe Tax is on there; until then from the rate for its address,
 * looked up once and kept; with neither, no tax is added and Settings says so.
 */
export const TaxStatus = z.object({
  source: z.enum(['stripe', 'address_rate', 'none']),
  /** Why Stripe Tax isn't being used yet, for the Settings copy. */
  stripe: z.enum(['active', 'not_connected', 'setup_needed']),
  /** The rate at the shop by kind of item, "7.75", when known. */
  rates: z.object({ goods: z.string().nullable(), labour: z.string().nullable(), food: z.string().nullable() }),
  pricesIncludeTax: z.boolean(),
});
export type TaxStatus = z.infer<typeof TaxStatus>;

export const Staff = z.object({
  id: Id,
  name: z.string().min(1),
  role: Role,
  active: z.boolean(),
});
export type Staff = z.infer<typeof Staff>;

export const ShopSettings = z.object({
  paymentMethods: z.object({ card: z.boolean(), cash: z.boolean(), split: z.boolean() }),
  tips: z.object({
    enabled: z.boolean(),
    mode: z.enum(['amounts', 'percentages']),
    /** Cents when `amounts`, whole percents when `percentages`. */
    presets: z.array(z.number().int().min(1)).max(4),
    goTo: z.enum(['raiser', 'hours']),
  }),
  startingCashCents: NonNegativeCents,
  twoCounts: z.boolean(),
  /** When only one person is on at close. */
  onePersonClose: z.enum(['owner_next_morning', 'wait_for_second']),
  /** Store-and-forward on the M2 only; Tap to Pay is always online. */
  offlineCards: z.object({ enabled: z.boolean(), limitCents: NonNegativeCents }),
  /** Prices at the counter: before tax (added at checkout), or with tax included ("a $9.00 taco costs $9.00"). */
  tax: z.object({ pricesIncludeTax: z.boolean() }),
  /** Most off a charge a role can give without a PIN, in whole percents. Null: no limit. */
  discountLimits: z.object({
    counter: z.number().int().min(0).max(100),
    manager: z.number().int().min(0).max(100),
    owner: z.number().int().min(0).max(100).nullable(),
  }),
  updatedAt: Timestamp,
});
export type ShopSettings = z.infer<typeof ShopSettings>;

/** A change to settings: owners only, enforced by the server. */
export const ShopSettingsPatch = ShopSettings.omit({ updatedAt: true }).partial();
export type ShopSettingsPatch = z.infer<typeof ShopSettingsPatch>;

export const DEFAULT_SETTINGS: Omit<ShopSettings, 'updatedAt'> = {
  paymentMethods: { card: true, cash: true, split: true },
  tips: { enabled: true, mode: 'amounts', presets: [500, 1000, 2000], goTo: 'raiser' },
  startingCashCents: 15000,
  twoCounts: true,
  onePersonClose: 'owner_next_morning',
  offlineCards: { enabled: false, limitCents: 50000 },
  tax: { pricesIncludeTax: false },
  discountLimits: { counter: 10, manager: 25, owner: null },
};
