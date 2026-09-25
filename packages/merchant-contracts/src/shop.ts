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
  /** What members see in Clear Partners: what the shop does, a line about it, and how to reach it. */
  listing: z.object({
    category: z.string().nullable(),
    oneLine: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
});
export type Shop = z.infer<typeof Shop>;

/** "08:00" to "18:00", in the shop's timezone. */
export const OpenSpan = z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) }).refine((s) => s.to > s.from, 'It closes after it opens');

/**
 * When the shop is open: the usual week (seven days, Monday first; null is closed) and the dates
 * that differ (closed all day, or other hours). Staff hours sit inside these, and members' "open
 * now" reads them.
 */
export const ShopHours = z.object({
  week: z.array(z.object({ day: z.number().int().min(0).max(6), open: OpenSpan.nullable() })).length(7),
  dates: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string().trim().min(1).max(60), open: OpenSpan.nullable() })).max(60),
});
export type ShopHours = z.infer<typeof ShopHours>;

/** What an owner can change about the shop: where it is (which sets sales tax and the reader location) and its timezone. */
export const ShopPatch = z
  .object({
    address: Address,
    timezone: z.string().min(1),
    name: z.string().trim().min(1).max(60),
    listing: z
      .object({
        category: z.string().trim().max(60).nullable(),
        oneLine: z.string().trim().max(140).nullable(),
        phone: z.string().trim().max(40).nullable(),
        email: z.string().trim().max(200).nullable(),
      })
      .partial(),
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
  /** A break: how long, and after how long on shift. Home shows who is due one. */
  breaks: z.object({ minutes: z.number().int().min(0).max(240), afterMinutes: z.number().int().min(60).max(960) }),
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
  breaks: { minutes: 30, afterMinutes: 300 },
  twoCounts: true,
  onePersonClose: 'owner_next_morning',
  offlineCards: { enabled: false, limitCents: 50000 },
  tax: { pricesIncludeTax: false },
  discountLimits: { counter: 10, manager: 25, owner: null },
};

/**
 * Set up the till (Home, owners and managers): the steps signup leaves for later, and which are
 * done. `team` lists who has been added besides the owner.
 */
export const SetupProgress = z.object({
  stripe: z.boolean(),
  reader: z.boolean(),
  items: z.boolean(),
  team: z.array(z.string()),
  cash: z.boolean(),
  tips: z.boolean(),
});
export type SetupProgress = z.infer<typeof SetupProgress>;
