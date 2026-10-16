import { z } from 'zod';
import { Id, NonNegativeCents, PositiveCents, Timestamp } from './common';
import { PointCode } from './devices';
import type { DiscountCode } from './catalog';
import type { PublicPay, PublicPayStarted } from './public';
import { OpenSpan } from './shop';

/**
 * Rewards: a shop's app, its points and its rewards (rewards spec, `docs/rewards-reference`).
 *
 * The same app serves one shop at `useclear.org/s/:slug` (or the shop's own domain) and every shop
 * a person has joined at `rewards.useclear.org`. A shop's look, earning rules, rewards and offers are
 * data, read from here; nothing in the app is per shop.
 *
 * Points are the shop's and are never money. They're counted on what was paid before tax and tip,
 * can't be bought, cashed out, sent or moved between shops, and only ever buy an item or an amount
 * off at that shop. A member's points are the sum of their ledger entries, never a stored number.
 */

// ---- Small types ---------------------------------------------------------------------------------

/** `#B4532A`. */
export const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'A colour is #RRGGBB');

/** Monday is 0, as in a shop's hours. */
export const Weekday = z.number().int().min(0).max(6);

/** Words a shop's slug can't be, because the app or the apex already uses them as paths. */
export const RESERVED_SLUGS = [
  'api', 'app', 'admin', 'www', 'rewards', 'hub', 'shops', 'scan', 'you', 'join', 'help', 'clear',
  'login', 'signin', 'signup', 'confirm', 'code', 'p', 'r', 's', 'c', 'k', 'pay', 'static', 'assets',
] as const;

/** `micasa`: a–z, 0–9 and dashes, 2 to 32, starting and ending with a letter or number. */
export const ShopSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/, 'Letters, numbers and dashes, 2 to 32')
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), 'That address is taken');
export type ShopSlug = z.infer<typeof ShopSlug>;

/** A reward's counter code: six characters, no I, L, O or U, shown as `K7P · 4QM`. */
export const ClaimCode = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{6}$/);

/** A person in rewards (`rwp_…`): a Clear member, or someone with only a phone number. */
export const PersonId = Id;

// ---- The shop's app ------------------------------------------------------------------------------

/** The type presets a shop picks from. Each maps to a family the app loads (`FONT_PRESETS`). */
export const FONT_PRESETS = {
  serif: { label: 'Serif', family: "'Fraunces', Georgia, serif" },
  grotesque: { label: 'Grotesque', family: "'Archivo', 'Instrument Sans', sans-serif" },
  rounded: { label: 'Rounded', family: "'Nunito', 'Instrument Sans', sans-serif" },
  instrument_sans: { label: 'Instrument Sans', family: "'Instrument Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif" },
} as const;
export type FontPreset = keyof typeof FONT_PRESETS;

/** A preset, or one the shop uploaded (`UploadedFont`). */
export const FontRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), preset: z.enum(Object.keys(FONT_PRESETS) as [FontPreset, ...FontPreset[]]) }),
  z.object({ kind: z.literal('uploaded'), fontId: Id }),
]);
export type FontRef = z.infer<typeof FontRef>;

/**
 * The shop's look, as CSS variables (`--b`, `--bi`, `--bp`, `--b2`, `--bf`). Amounts, the Clear
 * balance block and Clear's onboarding never take these: they keep Clear's own tokens.
 */
export const Brand = z.object({
  /** Square, at least 512px. Null draws the monogram. */
  logoUrl: z.url().nullable(),
  /** Two letters where there's no logo: "MC". */
  monogram: z.string().trim().min(1).max(2),
  /** The shop's colour (`--b`) and what reads on it (`--bi`). */
  colour: Hex,
  onColour: Hex,
  /** The app's paper (`--bp`) and the deeper paper under rules and inputs (`--b2`). */
  paper: Hex,
  paper2: Hex,
  headingFont: FontRef,
  textFont: FontRef,
});
export type Brand = z.infer<typeof Brand>;

type BrandColours = Pick<Brand, 'colour' | 'onColour' | 'paper' | 'paper2'>;
/** Settings › Shop app › Colour. Custom is any colours that pass `brandContrast`. */
export const BRAND_PRESETS: Record<'terracotta' | 'ink' | 'olive' | 'plum', { label: string } & BrandColours> = {
  terracotta: { label: 'Terracotta', colour: '#B4532A', onColour: '#FBF3EA', paper: '#F1EADF', paper2: '#E8DCCB' },
  ink: { label: 'Ink', colour: '#16211D', onColour: '#DFE3DE', paper: '#DFE3DE', paper2: '#C5CAC5' },
  olive: { label: 'Olive', colour: '#55612B', onColour: '#F4F5EA', paper: '#ECEEE0', paper2: '#DCE0C8' },
  plum: { label: 'Plum', colour: '#8C3B5E', onColour: '#FBEFF4', paper: '#F2E9EC', paper2: '#E6D3DA' },
};

/** What the app calls points. A custom name has its one and its many: "stamp", "stamps". */
export const PointsName = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('points') }),
  z.object({ kind: z.literal('stars') }),
  z.object({ kind: z.literal('custom'), one: z.string().trim().min(1).max(16), many: z.string().trim().min(1).max(16) }),
]);
export type PointsName = z.infer<typeof PointsName>;

/** A shop's app config: one per shop. Public, through `PublicShopApp`. */
export const ShopApp = z.object({
  slug: ShopSlug,
  enabled: z.boolean(),
  brand: Brand,
  pointsName: PointsName,
  /** Discount codes shown in the app as offers, in this order. Made in Settings › Discounts. */
  offerCodeIds: z.array(Id),
  /** Bumped on every save; the public config is cached by it. */
  configVersion: z.number().int().min(1),
  updatedAt: Timestamp,
});
export type ShopApp = z.infer<typeof ShopApp>;

/** An uploaded font, after its checks. The licence is the shop's declaration, kept with the upload. */
export const UploadedFont = z.object({
  id: Id,
  /** "Casa Display" */
  name: z.string(),
  fileName: z.string(),
  sizeBytes: z.number().int().min(1).max(1_048_576),
  /** What was uploaded; it's always served as WOFF2. */
  uploadedAs: z.enum(['woff2', 'otf', 'ttf']),
  url: z.url(),
  checks: z.object({
    /** A–Z, a–z, 0–9, accents and $. */
    glyphs: z.enum(['passed', 'failed']),
    /** Characters it lacks, when glyphs failed. */
    missing: z.array(z.string()),
    /** Readable at 14px on the menu and rewards. */
    legibility: z.enum(['passed', 'failed']),
  }),
  usedFor: z.enum(['headings', 'everything']),
  licence: z.object({ declaredAt: Timestamp, declaredBy: Id }),
  uploadedAt: Timestamp,
});
export type UploadedFont = z.infer<typeof UploadedFont>;

/**
 * `POST /api/merchant/shop-app/fonts`, multipart: the file, and these fields. Refused over 1 MB, or
 * without the licence declared. A font that fails a check is kept, so the sheet can say why.
 */
export const UploadFontFields = z.object({
  name: z.string().trim().min(1).max(40),
  usedFor: z.enum(['headings', 'everything']),
  licenceDeclared: z.literal(true, 'Confirm you have the right to use it in an app and on the web'),
});
export const MAX_FONT_BYTES = 1_048_576;

// ---- Earning -------------------------------------------------------------------------------------

/** Where a boost applies: some days all day, some hours on some days, or items in some categories. */
export const BoostScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('days'), days: z.array(Weekday).min(1).max(7) }),
  z.object({ kind: z.literal('hours'), days: z.array(Weekday).min(1).max(7), span: OpenSpan }),
  z.object({ kind: z.literal('categories'), categories: z.array(z.string().min(1)).min(1) }),
]);
export type BoostScope = z.infer<typeof BoostScope>;

/** "Double points · Tuesdays". Only the biggest boost that applies counts; they never stack. */
export const Boost = z.object({
  id: Id,
  name: z.string().trim().min(1).max(40),
  /** 1.5, 2, 3: in halves, up to 5. */
  multiplier: z.number().min(1.5).max(5).refine((m) => Number.isInteger(m * 2), 'Boosts go up in halves'),
  scope: BoostScope,
  on: z.boolean(),
});
export type Boost = z.infer<typeof Boost>;

export const EXPIRIES = ['never', '12m', '6m'] as const;

/**
 * How points are earned. Versioned: a save makes a new version, effective from then, and every
 * ledger entry keeps the version that made it, so a change never rewrites history.
 */
export const EarnRules = z
  .object({
    version: z.number().int().min(1),
    effectiveAt: Timestamp,
    /** Dollars spent, or one stamp a visit like a punch card. */
    unit: z.enum(['dollars', 'visits']),
    /** Dollars: `pointsPer` points for every `perAmountCents` paid. Visits: unused (one a visit). */
    pointsPer: z.number().int().min(1).max(1000),
    perAmountCents: PositiveCents,
    /** Visits: the least a visit must pay to earn its stamp. At most one a day. */
    visitMinCents: NonNegativeCents,
    /** Visits: stamps to a card ("6 of 10 stamps"). */
    cardSize: z.number().int().min(2).max(50),
    /** Dollars: leftover cents carry to the next visit, per member. */
    keepTheChange: z.boolean(),
    /** Paying with Clear. It is one more candidate for the biggest multiplier, never on top of a boost. */
    clearMultiplier: z.union([z.literal(1), z.literal(1.5), z.literal(2)]),
    boosts: z.array(Boost).max(12),
    /** Points when someone joins, once. */
    joinBonus: z.number().int().min(0).max(10_000),
    /** A reward given in their birthday month (asks the month only), or none. */
    birthdayRewardId: Id.nullable(),
    /** Points each, to both, when a friend they brought first pays; or none. */
    referralBonus: z.number().int().min(1).max(10_000).nullable(),
    /** Counted from the member's last visit. A change applies to points earned after it. */
    expiry: z.enum(EXPIRIES),
  });
export type EarnRules = z.infer<typeof EarnRules>;

/** A save of the rules: everything but the version, which the server sets. */
export const EarnRulesInput = z.object({
  unit: z.enum(['dollars', 'visits']),
  pointsPer: z.number().int().min(1).max(1000),
  perAmountCents: PositiveCents,
  visitMinCents: NonNegativeCents,
  cardSize: z.number().int().min(2).max(50),
  keepTheChange: z.boolean(),
  clearMultiplier: z.union([z.literal(1), z.literal(1.5), z.literal(2)]),
  boosts: z.array(Boost.omit({ id: true }).extend({ id: Id.optional() })).max(12),
  joinBonus: z.number().int().min(0).max(10_000),
  birthdayRewardId: Id.nullable(),
  referralBonus: z.number().int().min(1).max(10_000).nullable(),
  expiry: z.enum(EXPIRIES),
});

// ---- Rewards -------------------------------------------------------------------------------------

/**
 * What a reward gives: one of some items (a free drink: the line's own price, options included, up
 * to a cap), an amount off, or a percent off; the last two optionally only on some categories.
 * Never cash.
 */
export const RewardGives = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), itemIds: z.array(Id).min(1), maxCents: PositiveCents.nullable() }),
  z.object({ kind: z.literal('amount'), amountCents: PositiveCents, categories: z.array(z.string().min(1)).min(1).nullable() }),
  z.object({ kind: z.literal('percent'), percent: z.number().int().min(1).max(100), categories: z.array(z.string().min(1)).min(1).nullable() }),
]);
export type RewardGives = z.infer<typeof RewardGives>;

export const Reward = z.object({
  id: Id,
  name: z.string().trim().min(1).max(60),
  gives: RewardGives,
  /** In points, or stamps in visits mode. */
  cost: z.number().int().min(1).max(1_000_000),
  /** Per customer. */
  limit: z.enum(['none', 'daily', 'weekly']),
  /** Shown to everyone; only Clear members can use it. */
  clearMembersOnly: z.boolean(),
  /** "Jamaica or Horchata, any size", for the shop's table; built from the items when null. */
  note: z.string().max(80).nullable(),
});
export type Reward = z.infer<typeof Reward>;
export const RewardInput = Reward.omit({ id: true });

// ---- The ledger ----------------------------------------------------------------------------------

export const LOYALTY_ENTRY_KINDS = ['earn', 'redeem', 'refund', 'bonus_join', 'bonus_birthday', 'bonus_referral', 'adjust', 'expire'] as const;

/** One line of a member's points at one shop. Append-only; the balance is the sum. */
export const LoyaltyEntry = z.object({
  id: Id,
  kind: z.enum(LOYALTY_ENTRY_KINDS),
  /** Signed: + earned, − used, reversed or expired. */
  points: z.number().int(),
  orderId: Id.nullable(),
  rewardId: Id.nullable(),
  rulesVersion: z.number().int().min(1),
  /** An adjustment's reason, required for `adjust`. */
  reason: z.string().max(200).nullable(),
  /** The staff member, for an adjustment or a redemption at the counter. */
  by: Id.nullable(),
  at: Timestamp,
});
export type LoyaltyEntry = z.infer<typeof LoyaltyEntry>;

/** Someone's membership of one shop's rewards, and their consent to share with it. */
export const Membership = z.object({
  shopSlug: ShopSlug,
  memberId: PersonId,
  joinedAt: Timestamp,
  /** When they agreed the shop sees their name, number and what they buy there; and to which line. */
  consentAt: Timestamp,
  consentVersion: z.string().min(1),
  texts: z.enum(['codes', 'codes_and_offers']),
  /** The month only, 1–12, when they gave it. */
  birthMonth: z.number().int().min(1).max(12).nullable(),
  /** Who brought them, for the referral bonus. */
  referredBy: PersonId.nullable(),
});
export type Membership = z.infer<typeof Membership>;

/**
 * A reward claimed for the counter: a short code and a QR, good for 15 minutes. Scanned or typed,
 * it becomes the order's reward discount; the points come off when that order is paid, so a code
 * that's never used costs nothing.
 */
export const RewardClaim = z.object({
  id: Id,
  code: ClaimCode,
  /** What the QR carries: `<host>/k/<code>`. */
  qr: z.string().min(1),
  rewardId: Id,
  rewardName: z.string(),
  cost: z.number().int().min(1),
  expiresAt: Timestamp,
  status: z.enum(['open', 'applied', 'used', 'expired']),
  orderId: Id.nullable(),
});
export type RewardClaim = z.infer<typeof RewardClaim>;
export const CLAIM_MINUTES = 15;

// ---- The counter ---------------------------------------------------------------------------------

/** Who an order is for, once a member is added at the cart. */
export const OrderCustomer = z.object({
  memberId: PersonId,
  /** The staff member; null when they added themselves in their app, or paid with Clear unadded. */
  addedBy: Id.nullable(),
  addedVia: z.enum(['code', 'phone', 'claim', 'app']),
  at: Timestamp,
});
export type OrderCustomer = z.infer<typeof OrderCustomer>;

/** A ready reward, matched to the cart: "75 points · matches 1 × Jamaica in this cart". */
export const ReadyReward = z.object({
  rewardId: Id,
  name: z.string(),
  cost: z.number().int().min(1),
  /** What it takes off this order, when it matches; null when nothing in the cart fits. */
  amountCents: NonNegativeCents.nullable(),
  matches: z.object({ lineId: Id, label: z.string() }).nullable(),
  /** Clear members only, and this person isn't one. */
  locked: z.boolean(),
});
export type ReadyReward = z.infer<typeof ReadyReward>;

/**
 * A customer as the counter sees them: their name, whether Clear can be sent to them, and their
 * points here. **Never a balance, and nothing from another shop.** Strict, so a field that isn't
 * listed here fails to parse rather than reaching the tablet.
 */
export const CounterCustomer = z.strictObject({
  firstName: z.string(),
  lastInitial: z.string().max(1).nullable(),
  isClearMember: z.boolean(),
  /** Clear can go straight to their phone: a member who has set up Clear and isn't restricted. */
  canPayWithClear: z.boolean(),
  /** Null when they haven't joined this shop's rewards. */
  membership: z
    .strictObject({
      points: z.number().int(),
      joinedAt: Timestamp,
      readyRewards: z.array(ReadyReward),
      nextReward: z.strictObject({ rewardId: Id, name: z.string(), toGo: z.number().int().min(1) }).nullable(),
    })
    .nullable(),
  /** Their last paid visit here: "last here Oct 12, Table 6". Null for a first visit. */
  lastVisit: z.strictObject({ at: Timestamp, table: z.string().nullable() }).nullable(),
});
export type CounterCustomer = z.infer<typeof CounterCustomer>;

/**
 * `POST /api/merchant/orders/:id/customer`. A scanned code (the member's own: Send in Clear, or
 * Show my code in rewards), or a phone number, which texts them a link to confirm. A reward's
 * counter code goes through the order's discount instead (`DiscountRequest` `claim`).
 */
export const AddCustomer = z.discriminatedUnion('via', [
  z.object({ via: z.literal('code'), code: z.string().min(1).max(400) }),
  z.object({ via: z.literal('phone'), phone: z.string().trim().min(7).max(24) }),
]);

/**
 * The answer, and what `GET /api/merchant/orders/:id/customer` polls. By phone it stays `pending`
 * until they confirm on their phone, whether or not the number belongs to anyone, so typing a
 * number never reveals an account.
 */
export const OrderCustomerState = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }),
  z.object({ status: z.literal('pending'), expiresAt: Timestamp }),
  z.object({ status: z.literal('added'), customer: CounterCustomer, earnsPoints: z.number().int().min(0).nullable() }),
]);
export type OrderCustomerState = z.infer<typeof OrderCustomerState>;

/** `GET /api/rewards/confirm/:token`: what their phone shows before they confirm. */
export const CounterConfirm = z.object({ shopName: z.string(), staffFirstName: z.string(), expiresAt: Timestamp });
export type CounterConfirm = z.infer<typeof CounterConfirm>;

/**
 * A member's code, as rewards' Show my code and Clear's Send page draw it:
 * `<origin>/send?to=<wallet>&id=<code>`. The wallet is public, so attaching someone to an order
 * needs the signed `id`, good for two minutes. A bare wallet still sends a Clear request.
 */
export const IdentityCode = z.object({ payload: z.string().min(1), expiresAt: Timestamp });
export type IdentityCode = z.infer<typeof IdentityCode>;
export const IDENTITY_CODE_SECONDS = 120;

// ---- Domains and store builds --------------------------------------------------------------------

export const ShopDomain = z.object({
  domain: z.string().regex(/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, 'That isn’t a domain'),
  shopSlug: ShopSlug,
  status: z.enum(['pending', 'verified', 'failed']),
  /** The record the shop adds where it bought the domain. */
  record: z.object({ type: z.enum(['CNAME', 'A']), name: z.string(), value: z.string() }),
  checkedAt: Timestamp.nullable(),
  verifiedAt: Timestamp.nullable(),
});
export type ShopDomain = z.infer<typeof ShopDomain>;
export const SetShopDomain = z.object({ domain: ShopDomain.shape.domain });

/** A store app build: a record only. Clear's CI builds from the shop's config; nothing is submitted from here. */
export const StoreBuild = z.object({
  id: Id,
  platform: z.enum(['ios', 'android']),
  bundleId: z.string().regex(/^[a-zA-Z][\w-]*(\.[a-zA-Z][\w-]*)+$/),
  version: z.string().min(1),
  configVersion: z.number().int().min(1),
  review: z.enum(['not_submitted', 'in_review', 'approved', 'rejected', 'live']),
  note: z.string().nullable(),
  updatedAt: Timestamp,
});
export type StoreBuild = z.infer<typeof StoreBuild>;

// ---- What the apps read --------------------------------------------------------------------------

/** A reward as the customer's app lists it. */
export const RewardView = z.object({
  id: Id,
  name: z.string(),
  /** "75 points · any size" */
  detail: z.string(),
  cost: z.number().int().min(1),
  clearMembersOnly: z.boolean(),
});
export type RewardView = z.infer<typeof RewardView>;

/** A discount code shown in the app: "Taco Tuesday · Two tacos for $7, in the shop or to go · Tue". */
export const OfferView = z.object({
  codeId: Id,
  code: z.string(),
  title: z.string(),
  detail: z.string(),
  /** "Tue", "Ends Oct 31", "Nov". */
  when: z.string(),
  audience: z.enum(['everyone', 'members', 'clear_members']),
});
export type OfferView = z.infer<typeof OfferView>;

/** How the shop's earning reads, worked out from the rules by `earnLabels`. */
export const EarnSummary = z.object({
  unit: z.enum(['dollars', 'visits']),
  /** "1 point per $1", "$5 or more, once a day" */
  rate: z.string(),
  /** "Earn 1 point for every $1. Double on Tuesdays." */
  sentence: z.string(),
  /** "Points never expire" */
  expiry: z.string(),
  /** Visits only. */
  cardSize: z.number().int().nullable(),
  joinBonus: z.number().int().min(0),
});
export type EarnSummary = z.infer<typeof EarnSummary>;

/**
 * `GET /api/s/:slug`: public and cached by `configVersion`. Everything the app needs to dress
 * itself and show the shop to someone who hasn't joined.
 */
export const PublicShopApp = z.object({
  slug: ShopSlug,
  name: z.string(),
  brand: Brand,
  /** Where each uploaded font is served from, by id. Presets load from `FONT_PRESETS`. */
  fonts: z.record(z.string(), z.url()),
  pointsName: PointsName,
  earn: EarnSummary,
  /** "A point for every dollar, and a free agua fresca at 75." */
  pitch: z.string(),
  rewards: z.array(RewardView),
  offers: z.array(OfferView),
  configVersion: z.number().int().min(1),
});
export type PublicShopApp = z.infer<typeof PublicShopApp>;

/** A person in rewards, as their own app shows them. */
export const Person = z.object({
  id: PersonId,
  firstName: z.string(),
  lastInitial: z.string().max(1).nullable(),
  /** "(909) 555-0142", from their sign-in; null when they signed in another way. */
  phone: z.string().nullable(),
  isClearMember: z.boolean(),
});
export type Person = z.infer<typeof Person>;

/** `POST /api/rewards/me`, after Welcome: the first name, and nothing to verify. */
export const CreatePerson = z.object({ firstName: z.string().trim().min(1).max(40) });

/** The Clear side of a person, for the balance block: never a reason to guess in the app. */
export const ClearAccess = z.object({
  /** "Active", or "Not set up". */
  status: z.enum(['active', 'not_set_up']),
  /** Pay from the balance, and add money. Off means show Set up Clear. */
  canPayWithClear: z.boolean(),
  /** Over time also needs a credit line. */
  canPayOverTime: z.boolean(),
});
export type ClearAccess = z.infer<typeof ClearAccess>;

/**
 * `GET /api/s/:slug/me`, with a token for this shop: their membership, points, what's ready and
 * what's next, the offers they can use, and what Clear allows. The balance is read as the Clear app
 * reads it (`/api/balances`), never through the shop.
 */
export const RewardsMe = z.object({
  person: Person,
  membership: Membership.nullable(),
  points: z.number().int(),
  ready: z.array(RewardView),
  next: z.array(RewardView.extend({ toGo: z.number().int().min(1) })),
  offers: z.array(OfferView),
  earn: EarnSummary,
  clear: ClearAccess,
});
export type RewardsMe = z.infer<typeof RewardsMe>;

/** `GET /api/rewards/me/shops`, with the hub's token: every shop they've joined. */
export const MyShops = z.object({
  shops: z.array(
    z.object({
      slug: ShopSlug,
      name: z.string(),
      /** The tile: the shop's logo or monogram, in its colours and heading font. */
      brand: Brand.pick({ logoUrl: true, monogram: true, colour: true, onColour: true, headingFont: true }),
      /** Where an uploaded heading font is served from, when the tile uses one. */
      fonts: z.record(z.string(), z.url()).optional(),
      pointsName: PointsName,
      unit: z.enum(['dollars', 'visits']),
      points: z.number().int(),
      /** Visits only: "6 of 10 stamps". */
      cardSize: z.number().int().nullable(),
      readyCount: z.number().int().min(0),
      /** "160 to a free rotation" */
      next: z.object({ name: z.string(), toGo: z.number().int().min(1) }).nullable(),
      texts: z.enum(['codes', 'codes_and_offers']),
    }),
  ),
});
export type MyShops = z.infer<typeof MyShops>;

/** `GET /api/partners?near=lat,lng`: Clear shops with an app, nearest first, for Add a shop. */
export const Partners = z.object({
  partners: z.array(
    z.object({
      slug: ShopSlug,
      name: z.string(),
      brand: Brand.pick({ logoUrl: true, monogram: true, colour: true, onColour: true, headingFont: true }),
      /** Null without a location. */
      distanceMeters: z.number().int().min(0).nullable(),
      /** "1 point per $1", "stamps" */
      earns: z.string(),
      joined: z.boolean(),
    }),
  ),
});
export type Partners = z.infer<typeof Partners>;

/** `GET /api/s/:slug/activity`: purchases at this shop only. */
export const ShopActivity = z.object({
  items: z.array(
    z.object({
      orderId: Id,
      at: Timestamp,
      table: z.string().nullable(),
      totalCents: NonNegativeCents,
      paidWith: z.enum(['clear', 'card', 'cash', 'split']),
      points: z.object({ earned: z.number().int(), used: z.number().int() }),
    }),
  ),
});
export type ShopActivity = z.infer<typeof ShopActivity>;

/**
 * `GET /api/rewards/purchases`: a member's card purchases at Clear shops, the ones their rewards
 * recorded before (and after) they set up Clear, shown in Activity marked as card. Clear payments
 * aren't here (Activity has them from the chain), nor is cash, which Activity's "Cash" would misname.
 * Only once onboarding is submitted (rewards spec, Phase 6).
 */
export const MemberShopPurchases = z.object({
  items: z.array(
    z.object({
      orderId: Id,
      shop: z.object({ slug: ShopSlug.nullable(), name: z.string() }),
      at: Timestamp,
      /** What was paid by card, tip included. */
      amountCents: NonNegativeCents,
      /** The card's last four, so a sale on the member's own Clear card isn't listed twice. */
      cardLast4: z.string().regex(/^\d{4}$/).nullable(),
      /** Earned there, when they'd joined. */
      points: z.object({ earned: z.number().int(), name: PointsName }).nullable(),
    }),
  ),
});
export type MemberShopPurchases = z.infer<typeof MemberShopPurchases>;

/**
 * `GET /api/s/:slug/bill/:point`: a Point's bill as the signed-in customer sees it, with the reward
 * they have ready that matches it (on by default) and what they'd earn either way.
 */
export const ShopBill = z.object({
  pointCode: PointCode,
  orderId: Id,
  /** "Table 6" */
  table: z.string().nullable(),
  lines: z.array(z.object({ id: Id, name: z.string(), quantity: z.number().int().min(1), lineCents: NonNegativeCents })),
  /** With the reward on, and with it off. */
  withReward: z.object({ discountCents: NonNegativeCents, taxCents: NonNegativeCents, totalCents: NonNegativeCents, earnsPoints: z.number().int().min(0) }).nullable(),
  withoutReward: z.object({ discountCents: NonNegativeCents, taxCents: NonNegativeCents, totalCents: NonNegativeCents, earnsPoints: z.number().int().min(0) }),
  reward: z.object({ rewardId: Id, name: z.string(), cost: z.number().int(), amountCents: PositiveCents, pointsBefore: z.number().int() }).nullable(),
  /** The order already has a code or manual discount, so no reward can go on it. */
  hasDiscount: z.boolean(),
  /** Paying with Clear earns more at shops with the Clear multiplier on. */
  earnsWithClear: z.number().int().min(0),
});
export type ShopBill = z.infer<typeof ShopBill>;

/**
 * The Paid screen: what moved, money and points both ways. For a shop they haven't joined, what
 * joining now would give: "You'd have 33 points now: 25 for joining and 8 from this."
 */
export const ShopPaid = z.object({
  orderId: Id,
  amountCents: NonNegativeCents,
  paidAt: Timestamp,
  table: z.string().nullable(),
  paidWith: z.enum(['clear_balance', 'over_time', 'card']),
  points: z.object({ used: z.object({ reward: z.string(), points: z.number().int() }).nullable(), earned: z.number().int(), have: z.number().int() }).nullable(),
  joinOffer: z.object({ joinBonus: z.number().int(), fromThis: z.number().int(), total: z.number().int() }).nullable(),
});
export type ShopPaid = z.infer<typeof ShopPaid>;

/**
 * On a Clear charge, the reward that's on it, so the approve sheet can say "Free agua fresca ·
 * Applied at the counter · 75 points". Added to the charge view the Clear app already reads.
 */
export const ChargeReward = z.object({ name: z.string(), points: z.number().int().min(1), appliedBy: z.enum(['counter', 'customer']) });
export type ChargeReward = z.infer<typeof ChargeReward>;

// ---- What the apps send --------------------------------------------------------------------------

/**
 * `POST /api/s/:slug/join`, signed in. Optionally the order they just paid, so its points count:
 * "Paid somewhere new" joins with this visit included.
 */
export const JoinShop = z.object({
  texts: z.enum(['codes', 'codes_and_offers']),
  birthMonth: z.number().int().min(1).max(12).nullable(),
  /** The consent line they were shown, by version. */
  consentVersion: z.string().min(1),
  /** A friend's referral code, from their invite link. */
  ref: z.string().max(40).nullable(),
  /** An order they paid before joining, to credit. It must be theirs and at this shop. */
  orderId: Id.nullable(),
});
export const Joined = z.object({ membership: Membership, points: z.number().int(), credited: z.object({ join: z.number().int(), payment: z.number().int() }) });
export type Joined = z.infer<typeof Joined>;

export const UpdateMembership = z.object({
  texts: z.enum(['codes', 'codes_and_offers']).optional(),
  birthMonth: z.number().int().min(1).max(12).nullable().optional(),
});

/** `POST /api/s/:slug/session` and `/api/rewards/session`: a token that sees one shop, or the hub's. */
export const RewardsSession = z.object({ token: z.string().min(1), expiresAt: Timestamp, scope: z.union([z.object({ shop: ShopSlug }), z.object({ hub: z.literal(true) })]) });
export type RewardsSession = z.infer<typeof RewardsSession>;

// ---- Settings › Shop app -------------------------------------------------------------------------

/**
 * What a reward gives back: its worth against what it takes to earn ("Agua fresca: $3.50 for $75
 * spent is 4.7%"). A percent-off reward has no fixed worth and isn't counted.
 */
export const GiveBack = z.object({
  /** Percent, to one decimal. Null with no rewards that have a fixed worth. */
  low: z.number().nullable(),
  high: z.number().nullable(),
  lowWithClear: z.number().nullable(),
  highWithClear: z.number().nullable(),
  byReward: z.array(z.object({ rewardId: Id, worthCents: PositiveCents, spendCents: PositiveCents, percent: z.number() })),
});
export type GiveBack = z.infer<typeof GiveBack>;

/** `GET /api/merchant/shop-app`. Owners and managers edit it; the counter can view. */
export const ShopAppSettings = z.object({
  app: ShopApp,
  rules: EarnRules,
  rewards: z.array(Reward),
  fonts: z.array(UploadedFont),
  domain: ShopDomain.nullable(),
  storeBuilds: z.array(StoreBuild),
  /** "214 joined · 38 this week · 61 have Clear" */
  members: z.object({ joined: z.number().int().min(0), thisWeek: z.number().int().min(0), withClear: z.number().int().min(0) }),
  /** `useclear.org/s/micasa` */
  link: z.string(),
  giveBack: GiveBack,
  canEdit: z.boolean(),
});
export type ShopAppSettings = z.infer<typeof ShopAppSettings>;

/** `PATCH /api/merchant/shop-app`. New rules make a new version, effective now. */
export const ShopAppPatch = z.object({
  slug: ShopSlug.optional(),
  enabled: z.boolean().optional(),
  brand: Brand.partial().optional(),
  pointsName: PointsName.optional(),
  offerCodeIds: z.array(Id).optional(),
  rules: EarnRulesInput.optional(),
});

/**
 * `PATCH /api/merchant/shop-app/offers/:codeId`: Settings › Discounts' Show in app switch and who
 * sees it. Switching one on puts it last in `offerCodeIds`; off takes it out. Owners and managers.
 */
export const OfferPatch = z.object({
  showInApp: z.boolean().optional(),
  audience: z.enum(['everyone', 'members', 'clear_members']).optional(),
});

// ---- The rules, worked out the same way everywhere -----------------------------------------------
// The API ledger, the shop's give-back line and the app's "earns 12 points" all call these.

/** A line as earning sees it: what was paid for it, after its share of the discount, before tax. */
export interface EarnLine {
  netCents: number;
  category: string | null;
}

export interface EarnInput {
  rules: EarnRules;
  lines: EarnLine[];
  /** When it was paid, in the shop's own time: weekday (Monday 0) and "HH:MM". */
  at: { weekday: number; time: string };
  /** The part of the order paid with Clear, and the whole, both before tip. */
  clearCents: number;
  paidCents: number;
  /** Keep the change: the member's leftover cents from earlier visits. */
  carryCents: number;
  /** Visits: whether they've had today's stamp already. */
  stampedToday: boolean;
}

export interface Earned {
  points: number;
  /** The leftover to keep for next time (unchanged unless keep-the-change is on). */
  carryCents: number;
  /** The biggest multiplier that applied, for the receipt line. */
  multiplier: number;
}

const tenths = (m: number) => Math.round(m * 10);

function boostOn(b: Boost, line: EarnLine, at: EarnInput['at']): boolean {
  if (!b.on) return false;
  const s = b.scope;
  if (s.kind === 'days') return s.days.includes(at.weekday);
  if (s.kind === 'hours') return s.days.includes(at.weekday) && at.time >= s.span.from && at.time < s.span.to;
  return line.category !== null && s.categories.includes(line.category);
}

/** The biggest multiplier for one line, in tenths, with and without paying by Clear. */
function lineMultipliers(rules: EarnRules, line: EarnLine, at: EarnInput['at']): { plain: number; clear: number } {
  const plain = Math.max(10, ...rules.boosts.filter((b) => boostOn(b, line, at)).map((b) => tenths(b.multiplier)));
  return { plain, clear: Math.max(plain, tenths(rules.clearMultiplier)) };
}

/**
 * Points for one paid order. Dollars: counted on what was paid before tax and tip, times the biggest
 * multiplier that applies (a boost, or paying with Clear; never both), in whole steps of the rate,
 * with the leftover kept when keep-the-change is on. A split sale gets the Clear multiplier on its
 * Clear part only. Visits: one stamp for a visit that pays at least the minimum, at most once a day.
 */
export function earnPoints(input: EarnInput): Earned {
  const { rules, lines, at } = input;
  for (const n of [input.clearCents, input.paidCents, input.carryCents, ...lines.map((l) => l.netCents)]) {
    if (!Number.isInteger(n) || n < 0) throw new RangeError('Earning takes whole, non-negative cents');
  }
  if (input.clearCents > input.paidCents) throw new RangeError('The Clear part is more than was paid');
  const net = lines.reduce((s, l) => s + l.netCents, 0);
  const ms = lines.map((l) => lineMultipliers(rules, l, at));
  const top = Math.max(10, ...ms.map((m) => (input.clearCents > 0 ? m.clear : m.plain)));

  if (rules.unit === 'visits') {
    if (input.stampedToday || net < rules.visitMinCents || net === 0) return { points: 0, carryCents: input.carryCents, multiplier: 1 };
    return { points: Math.floor(top / 10), carryCents: input.carryCents, multiplier: top / 10 };
  }

  // Weighted cents, in tenths: each line at its plain multiplier on the card or cash part and its
  // Clear multiplier on the Clear part.
  const paid = input.paidCents;
  let weightedTenths = 0;
  if (paid > 0) {
    let num = 0;
    lines.forEach((l, i) => (num += l.netCents * (ms[i]!.plain * (paid - input.clearCents) + ms[i]!.clear * input.clearCents)));
    weightedTenths = Math.floor(num / paid);
  }
  const weighted = Math.floor(weightedTenths / 10);
  const pool = rules.keepTheChange ? weighted + input.carryCents : weighted;
  const steps = Math.floor(pool / rules.perAmountCents);
  return {
    points: steps * rules.pointsPer,
    carryCents: rules.keepTheChange ? pool - steps * rules.perAmountCents : input.carryCents,
    multiplier: top / 10,
  };
}

/**
 * What a refund takes back: the points earned on the refunded part, in proportion, rounded half
 * up; all of them when everything is refunded.
 */
export function refundPoints(earned: number, netCents: number, refundedNetCents: number): number {
  if (earned <= 0 || netCents <= 0 || refundedNetCents <= 0) return 0;
  if (refundedNetCents >= netCents) return earned;
  return Math.min(earned, Math.round((earned * refundedNetCents) / netCents));
}

/** What a reward is worth, in cents, from the prices of the items it gives; null for a percent off. */
export function rewardWorthCents(reward: Pick<Reward, 'gives'>, priceOf: (itemId: string) => number | null): number | null {
  const g = reward.gives;
  if (g.kind === 'amount') return g.amountCents;
  if (g.kind === 'percent') return null;
  const prices = g.itemIds.map(priceOf).filter((p): p is number => p !== null);
  if (prices.length === 0) return g.maxCents;
  const top = Math.max(...prices);
  return g.maxCents === null ? top : Math.min(top, g.maxCents);
}

const pct1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The give-back line: each reward's worth against the spend it takes to earn, lowest and highest,
 * and the same paying with Clear. Visits mode counts a stamp as the minimum spend.
 */
export function giveBack(rules: EarnRules, rewards: Pick<Reward, 'id' | 'gives' | 'cost'>[], priceOf: (itemId: string) => number | null): GiveBack {
  const perPoint = rules.unit === 'visits' ? rules.visitMinCents : rules.perAmountCents / rules.pointsPer;
  const byReward = rewards.flatMap((r) => {
    const worth = rewardWorthCents(r, priceOf);
    if (worth === null || worth <= 0 || perPoint <= 0) return [];
    const spend = Math.round(r.cost * perPoint);
    return [{ rewardId: r.id, worthCents: worth, spendCents: spend, percent: pct1((worth * 100) / spend) }];
  });
  if (byReward.length === 0) return { low: null, high: null, lowWithClear: null, highWithClear: null, byReward };
  const exact = byReward.map((b) => (b.worthCents * 100) / b.spendCents);
  const low = Math.min(...exact);
  const high = Math.max(...exact);
  const m = rules.clearMultiplier;
  return { low: pct1(low), high: pct1(high), lowWithClear: m > 1 ? pct1(low * m) : null, highWithClear: m > 1 ? pct1(high * m) : null, byReward };
}

/** The word for points, one or many. */
export function pointsWord(name: PointsName, count: number): string {
  const one = count === 1 || count === -1;
  if (name.kind === 'points') return one ? 'point' : 'points';
  if (name.kind === 'stars') return one ? 'star' : 'stars';
  return one ? name.one : name.many;
}

const dollars = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);
const DAY_PLURAL = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const TIMES: Record<string, string> = { '2': 'Double', '3': 'Triple' };

/** The rate and sentence the app shows: "1 point per $1"; "Earn 1 point for every $1. Double on Tuesdays." */
export function earnLabels(rules: EarnRules, name: PointsName): Pick<EarnSummary, 'rate' | 'sentence' | 'expiry'> {
  const many = pointsWord(name, 2);
  const capital = many.charAt(0).toUpperCase() + many.slice(1);
  const expiry = rules.expiry === 'never' ? `${capital} never expire` : `${capital} expire ${rules.expiry === '12m' ? '12' : '6'} months after your last visit`;
  if (rules.unit === 'visits') {
    const rate = rules.visitMinCents > 0 ? `${dollars(rules.visitMinCents)} or more, once a day` : 'Once a day';
    return { rate, sentence: `One ${pointsWord(name, 1)} a visit, ${rules.cardSize} to a card.`, expiry };
  }
  const word = pointsWord(name, rules.pointsPer);
  const rate = `${rules.pointsPer} ${word} per ${dollars(rules.perAmountCents)}`;
  const day = rules.boosts.find((b) => b.on && b.scope.kind === 'days' && b.scope.days.length === 1);
  const extra = day && day.scope.kind === 'days' ? ` ${TIMES[String(day.multiplier)] ?? `${day.multiplier}×`} on ${DAY_PLURAL[day.scope.days[0]!]}.` : '';
  return { rate, sentence: `Earn ${rules.pointsPer} ${word} for every ${dollars(rules.perAmountCents)}.${extra}`, expiry };
}

/** A claim code as the screen draws it: `K7P · 4QM`. */
export const claimCodeLabel = (code: string) => `${code.slice(0, 3)} · ${code.slice(3, 6)}`;

/** WCAG relative luminance contrast between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * The checks before a colour saves: what reads on the shop's colour (button text) at 4.5:1, and the
 * colour on its paper (headings, controls) at 3:1. Each failure is a sentence for the sheet.
 */
export function brandContrast(c: BrandColours): string[] {
  const out: string[] = [];
  if (contrastRatio(c.onColour, c.colour) < 4.5) out.push('Text on your colour is hard to read. Pick a lighter or darker one.');
  if (contrastRatio(c.colour, c.paper) < 3) out.push('Your colour is too close to the paper.');
  return out;
}

/** The merchant's rewards routes, part of `MerchantApi`. */
type In<T extends z.ZodType> = z.input<T>;

/** No sign-in. */
export interface RewardsPublicApi {
  shop(slug: string): Promise<PublicShopApp>;
  partners(near: { lat: number; lng: number } | null): Promise<Partners>;
  /** A typed-in number at the counter: what the link shows, then confirm or decline. */
  counterConfirm(token: string): Promise<CounterConfirm>;
  answerCounterConfirm(token: string, answer: 'confirm' | 'decline'): Promise<void>;
}

/**
 * Signed in. `session` and `hubSession` take the Privy session; everything else takes the scoped
 * token they return, and a shop's token only ever sees that shop.
 */
export interface RewardsMemberApi {
  session(slug: string): Promise<RewardsSession>;
  hubSession(): Promise<RewardsSession>;
  /** Null until Welcome has been answered. */
  person(): Promise<Person | null>;
  createPerson(input: In<typeof CreatePerson>): Promise<Person>;
  /** Delete my rewards account: every shop's points and consents. A Clear account is closed in Clear. */
  deletePerson(): Promise<void>;
  identityCode(): Promise<IdentityCode>;
  me(slug: string): Promise<RewardsMe>;
  join(slug: string, input: In<typeof JoinShop>): Promise<Joined>;
  updateMembership(slug: string, input: In<typeof UpdateMembership>): Promise<Membership>;
  /** Leave: deletes the points and the consent at this shop, and nothing else. */
  leave(slug: string): Promise<void>;
  claim(slug: string, rewardId: string): Promise<RewardClaim>;
  activity(slug: string): Promise<ShopActivity>;
  bill(slug: string, pointCode: string): Promise<ShopBill>;
  /** `POST /api/p/:code/pay` with this shop's token: the customer goes on the order, with the reward first. */
  pay(pointCode: string, input: In<typeof PublicPay>): Promise<PublicPayStarted>;
  paid(slug: string, orderId: string): Promise<ShopPaid>;
  myShops(): Promise<MyShops>;
}

/** The merchant's rewards routes, under `/api/merchant`. */
export interface MerchantRewardsApi {
  shopApp(): Promise<ShopAppSettings>;
  /** Owners and managers. */
  updateShopApp(input: In<typeof ShopAppPatch>): Promise<ShopAppSettings>;
  createReward(input: In<typeof RewardInput>): Promise<Reward>;
  updateReward(id: string, input: In<typeof RewardInput>): Promise<Reward>;
  removeReward(id: string): Promise<void>;
  /** Settings › Discounts: Show in app and the audience. */
  updateOffer(codeId: string, input: In<typeof OfferPatch>): Promise<DiscountCode>;
  uploadFont(file: Blob, fields: In<typeof UploadFontFields>): Promise<UploadedFont>;
  /** The give-back line for rules not yet saved, as the owner changes them. */
  giveBack(rules?: In<typeof EarnRulesInput>): Promise<GiveBack>;
  setDomain(input: In<typeof SetShopDomain>): Promise<ShopDomain>;
  checkDomain(): Promise<ShopDomain>;
  addCustomer(orderId: string, input: In<typeof AddCustomer>): Promise<OrderCustomerState>;
  orderCustomer(orderId: string): Promise<OrderCustomerState>;
  /** Before payment only. */
  removeCustomer(orderId: string): Promise<void>;
  /** Ask them to join: a prompt on their phone. Joining before they pay credits this order. */
  inviteCustomer(orderId: string): Promise<{ sentAt: string }>;
}
