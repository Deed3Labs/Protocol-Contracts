import { z } from 'zod';
import { CLEAR_VERSIONS, EventType, WebhookEndpoint } from '@clear/public-api-contracts';
import { Id, PositiveCents, Timestamp } from './common';

/**
 * Pay with Clear, as the merchant app sees it (pay spec §5 and §6): API keys, the websites allowed to
 * use them, webhook endpoints and their deliveries, and payment links. The public `/v1` shapes are in
 * `@clear/public-api-contracts`; these are the merchant app's views of the same things, with who made
 * them and how they're doing. Owners and managers only: the counter never sees Developers.
 */

// ---- Keys ------------------------------------------------------------------------------------------

/**
 * `clear_pk_test_…`, `clear_pk_live_…`, `clear_sk_test_…`, `clear_sk_live_…`, then 24 base62 characters:
 * Clear's own prefix, never Stripe's `pk_`/`sk_`, so a scanner can tell a leaked Clear key from a
 * Stripe one (pay DECISIONS, Hard Stop 4). The spec's `pk_live_mc8Q2v` is drawn short, and before this. A publishable key is safe in a web page; a secret key is stored
 * hashed and shown in full once, when it's made or rolled.
 */
export const API_KEY_PATTERN = /^clear_(pk|sk)_(test|live)_[0-9A-Za-z]{24}$/;
export const API_KEY_KINDS = ['publishable', 'secret'] as const;

export const ApiKey = z.object({
  id: Id,
  kind: z.enum(API_KEY_KINDS),
  livemode: z.boolean(),
  /** The publishable key in full; null for a secret key, which is never shown again. */
  token: z.string().nullable(),
  /** "9fA2": what Developers shows of a secret key ("clear_sk_live_…9fA2"). */
  last4: z.string().length(4),
  createdAt: Timestamp,
  /** Staff id. */
  createdBy: Id.nullable(),
  /** When this key was rolled. Its replacement is a new key; this one keeps working until `expiresAt`. */
  rolledAt: Timestamp.nullable(),
  /** A rolled secret key stops working 24 hours after the roll. Null while it's current. */
  expiresAt: Timestamp.nullable(),
  /** What a request with this key and no `Clear-Version` runs at. */
  pinnedVersion: z.enum(CLEAR_VERSIONS),
});
export type ApiKey = z.infer<typeof ApiKey>;

/** How long a rolled secret key keeps working. */
export const ROLLED_KEY_HOURS = 24;

/** A new or rolled secret key: the only time its secret is shown. */
export const NewSecretKey = z.object({ key: ApiKey, secret: z.string().regex(API_KEY_PATTERN) });
export type NewSecretKey = z.infer<typeof NewSecretKey>;

// ---- Allowed websites --------------------------------------------------------------------------------

/**
 * A website the script may open on, and the modal may be framed by. An origin only, https only;
 * `localhost` (and 127.0.0.1) only for test keys. Adding one also registers it for Apple Pay and
 * Google Pay on the shop's card processor.
 */
export const AllowedSite = z.object({
  /** `https://micasatacos.com`. Developers shows its host. */
  origin: z.string(),
  addedAt: Timestamp,
  addedBy: Id.nullable(),
  /** A localhost origin: test keys only. */
  testOnly: z.boolean(),
});
export type AllowedSite = z.infer<typeof AllowedSite>;

export const AddAllowedSite = z.object({ site: z.string().trim().min(1).max(253) });

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * What someone typed into "Add a site", as an origin, or why it can't be one. Takes "micasatacos.com",
 * "https://order.micasatacos.com/checkout" (the path is dropped) and "http://localhost:3000".
 */
export function allowedOrigin(input: string): { ok: true; origin: string; testOnly: boolean } | { ok: false; reason: string } {
  const typed = input.trim();
  if (!typed) return { ok: false, reason: 'Type the website’s address' };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    return { ok: false, reason: 'That isn’t a website’s address' };
  }
  const host = url.hostname.toLowerCase();
  const loopback = LOOPBACK.has(host);
  if (url.username || url.password) return { ok: false, reason: 'That isn’t a website’s address' };
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    return { ok: false, reason: 'Pay with Clear only opens on https websites' };
  }
  if (host.includes('*')) return { ok: false, reason: 'Add each website on its own' };
  if (!loopback && (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('['))) {
    return { ok: false, reason: 'Use the website’s name, not its IP address' };
  }
  if (!loopback && !host.includes('.')) return { ok: false, reason: 'That isn’t a website’s address' };
  return { ok: true, origin: url.origin, testOnly: loopback };
}

/** "micasatacos.com", as Developers lists it; a localhost origin keeps its scheme and port. */
export const siteLabel = (origin: string) => {
  const url = new URL(origin);
  return LOOPBACK.has(url.hostname) ? origin : url.host;
};

// ---- Webhooks ------------------------------------------------------------------------------------

/**
 * An endpoint as Developers shows it. Healthy when its last delivery got a 2xx; failing when its last
 * attempt didn't; new before its first delivery.
 */
export const MerchantWebhookEndpoint = WebhookEndpoint.omit({ secret: true }).extend({
  health: z.enum(['new', 'healthy', 'failing', 'disabled']),
  createdBy: Id.nullable(),
});
export type MerchantWebhookEndpoint = z.infer<typeof MerchantWebhookEndpoint>;

export const AddWebhookEndpoint = z.object({
  url: z.url({ protocol: /^https$/ }).max(2048),
  events: z.array(EventType).min(1),
  livemode: z.boolean(),
});

/** Shown once, when an endpoint is added. */
export const NewWebhookEndpoint = z.object({ endpoint: MerchantWebhookEndpoint, secret: z.string() });
export type NewWebhookEndpoint = z.infer<typeof NewWebhookEndpoint>;

/** One row of Recent deliveries: "payment.succeeded · catering-1042 · 10:42am · 200". */
export const WebhookDelivery = z.object({
  id: Id,
  endpointId: Id,
  eventId: z.string(),
  eventType: EventType,
  /** The payment's reference, or its id when it has none. */
  reference: z.string().nullable(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  attempts: z.number().int().min(0),
  /** The endpoint's last answer; null when it couldn't be reached. */
  responseCode: z.number().int().nullable(),
  /** The last attempt, or when it was made if none yet. */
  at: Timestamp,
  /** The next retry, while there is one (3 days in all). */
  nextAttemptAt: Timestamp.nullable(),
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

// ---- Payment links -------------------------------------------------------------------------------

export const LINK_EXPIRIES = ['never', '7d', '30d'] as const;

/**
 * A payment link as the merchant app sees it. The QR is drawn by the app from `url`, as the
 * counter's charge codes are.
 */
export const MerchantPaymentLink = z.object({
  id: Id,
  livemode: z.boolean(),
  slug: z.string(),
  /** `https://pay.useclear.org/l/micasa-tray12`. */
  url: z.string(),
  /** The item's name, or "Payment" for an amount; Charges shows it beside Link. */
  name: z.string(),
  /** An amount link: what the customer pays. Null for an item. */
  amountCents: PositiveCents.nullable(),
  /** An item link: the Inventory item and how many. Null for an amount. */
  itemId: Id.nullable(),
  quantity: z.number().int().min(1).nullable(),
  /** What the customer pays today, tax included ($161.48 for the taco tray). */
  totalCents: PositiveCents,
  note: z.string().nullable(),
  expiresAt: Timestamp.nullable(),
  allowOverTime: z.boolean(),
  active: z.boolean(),
  createdAt: Timestamp,
  createdBy: Id.nullable(),
});
export type MerchantPaymentLink = z.infer<typeof MerchantPaymentLink>;

const LinkOptions = {
  note: z.string().trim().min(1).max(200).nullable(),
  expires: z.enum(LINK_EXPIRIES),
  allowOverTime: z.boolean(),
};

/** New charge › Send a link: an amount, or an item from Inventory with a quantity. */
export const CreatePaymentLink = z.discriminatedUnion('for', [
  z.object({ for: z.literal('amount'), amountCents: z.number().int().min(50), ...LinkOptions }),
  z.object({ for: z.literal('item'), itemId: Id, quantity: z.number().int().min(1).max(99), ...LinkOptions }),
]);

// ---- Developers ------------------------------------------------------------------------------------

/** The test member and test card, as Testing lists them. They exist in test mode only. */
export const TEST_MEMBER = { phone: '(555) 010-0100', e164: '+15550100100', code: '000000' } as const;
export const TEST_CARD = '4242 4242 4242 4242';

/** Settings › Developers, both modes at once: the pane's Test/Live switch only chooses what it shows. */
export const DevelopersView = z.object({
  keys: z.array(ApiKey),
  sites: z.array(AllowedSite),
  endpoints: z.array(MerchantWebhookEndpoint),
  /** The latest 20 per mode. */
  deliveries: z.array(WebhookDelivery),
  /** Card is offered only with a card processor connected, so Testing says so. */
  cardsConnected: z.boolean(),
  /** Build with AI: the docs link and the paste-in prompt, with the shop's live publishable key in it. */
  ai: z.object({ llmsUrl: z.string(), prompt: z.string(), mcpUrl: z.string() }),
});
export type DevelopersView = z.infer<typeof DevelopersView>;

/** The spec's paste-in prompt (§7), word for word, with the shop's publishable key. */
export const pasteInPrompt = (publishableKey: string) =>
  [
    'Add Pay with Clear to this site.',
    'Read https://useclear.org/llms.txt first.',
    `Use publishable key ${publishableKey}.`,
    'Attach it to the existing checkout button; do not add a new button.',
    'Never put the amount in the browser: create the payment on the server',
    'with CLEAR_SECRET_KEY from the environment, and fulfil orders from the',
    'payment.succeeded webhook, not from the page.',
  ].join('\n');

/**
 * The merchant app's Pay with Clear calls. A separate interface until the merchant mock implements it
 * (Phase 3 for links, Phase 4 for the rest), as `MerchantRewardsApi` was; then `MerchantApi` extends it.
 */
export interface MerchantPayApi {
  // ---- Payment links (owners and managers) ----
  paymentLinks(): Promise<MerchantPaymentLink[]>;
  createPaymentLink(input: z.input<typeof CreatePaymentLink>): Promise<MerchantPaymentLink>;
  deactivatePaymentLink(id: string): Promise<MerchantPaymentLink>;

  // ---- Developers (owners and managers) ----
  developers(): Promise<DevelopersView>;
  /** Makes the mode's publishable and secret keys, the first time. */
  createKeys(livemode: boolean): Promise<NewSecretKey>;
  /** A new secret key; the old one works for 24 more hours. */
  rollSecretKey(id: string): Promise<NewSecretKey>;
  addSite(input: z.input<typeof AddAllowedSite>): Promise<AllowedSite>;
  removeSite(origin: string): Promise<void>;
  addWebhookEndpoint(input: z.input<typeof AddWebhookEndpoint>): Promise<NewWebhookEndpoint>;
  removeWebhookEndpoint(id: string): Promise<void>;
}

