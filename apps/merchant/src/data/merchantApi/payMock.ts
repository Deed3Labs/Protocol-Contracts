import {
  AddAllowedSite,
  AddWebhookEndpoint,
  allowedOrigin,
  ApiKey,
  CreatePaymentLink,
  pasteInPrompt,
  ROLLED_KEY_HOURS,
  siteLabel,
  type AllowedSite,
  type CatalogItem,
  type MerchantPaymentLink,
  type MerchantPayApi,
  type MerchantWebhookEndpoint,
  type TaxKind,
  type WebhookDelivery,
} from '@clear/merchant-contracts';
import { price } from './pricing';

/**
 * Pay with Clear's links in the mock (pay spec §5), following the server (apps/api
 * services/merchant/pay/links.ts): an amount is what the customer pays, an item is priced and taxed
 * at the shop's rates, owners and managers make and turn off links, and the address is the shop's
 * everyday name and six characters.
 */

export interface PayLinksHost {
  shopName: string;
  now: () => string;
  id: (prefix: string) => string;
  viewer: () => string;
  isManager: (staffId: string) => boolean;
  refuse: (message: string, status?: number, code?: string) => never;
  items: () => CatalogItem[];
  rates?: Record<TaxKind, number>;
  inclusive: () => boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_DAYS = { never: null, '7d': 7, '30d': 30 } as const;
const PAY_BASE = 'https://pay.useclear.org';

/** "Mi Casa Tacos" → "micasa", as the server derives a shop without an app. */
export function slugBase(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const everyday = words.length >= 3 ? words.slice(0, -1) : words;
  const base = everyday.join('').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 24);
  return base.length >= 2 ? base : 'shop';
}

export function createPayLinksMock(h: PayLinksHost) {
  const links = new Map<string, MerchantPaymentLink>();
  let n = 0;
  const suffix = () => {
    n += 1;
    return `${'kmpqrt'[n % 6]}${(n * 7919).toString(36).padStart(5, 'x')}`.slice(0, 6);
  };
  const manager = () => {
    if (!h.isManager(h.viewer())) h.refuse('that needs a manager', 403, 'forbidden');
  };
  const totalFor = (item: CatalogItem, quantity: number) =>
    price([{ lineCents: item.priceCents * quantity, taxKind: item.taxKind, category: item.category }], null, { inclusive: h.inclusive(), rates: h.rates }).total;

  const api: Pick<MerchantPayApi, 'paymentLinks' | 'createPaymentLink' | 'deactivatePaymentLink'> = {
    async paymentLinks() {
      manager();
      return [...links.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    async createPaymentLink(input) {
      manager();
      const parsed = CreatePaymentLink.safeParse(input);
      if (!parsed.success) h.refuse(parsed.error.issues[0]?.message ?? 'That link isn’t valid', 422, 'invalid');
      const r = parsed.data;
      const item = r.for === 'item' ? h.items().find((i) => i.id === r.itemId && !i.archivedAt) : null;
      if (r.for === 'item' && !item) h.refuse('That item isn’t for sale', 422, 'invalid');
      if (item?.optionGroups.some((g) => g.required)) h.refuse('An item with options to choose can’t be a link yet. Use an amount.', 422, 'invalid');
      const now = h.now();
      const days = EXPIRY_DAYS[r.expires];
      const slug = `${slugBase(h.shopName)}-${suffix()}`;
      const link: MerchantPaymentLink = {
        id: h.id('plink'),
        livemode: true,
        slug,
        url: `${PAY_BASE}/l/${slug}`,
        name: item?.name ?? 'Payment',
        amountCents: r.for === 'amount' ? r.amountCents : null,
        itemId: item?.id ?? null,
        quantity: r.for === 'item' ? r.quantity : null,
        totalCents: item ? totalFor(item, r.for === 'item' ? r.quantity : 1) : r.for === 'amount' ? r.amountCents : 0,
        note: r.note,
        expiresAt: days === null ? null : new Date(Date.parse(now) + days * DAY_MS).toISOString(),
        allowOverTime: r.allowOverTime,
        active: true,
        createdAt: now,
        createdBy: h.viewer(),
      };
      links.set(link.id, link);
      return link;
    },
    async deactivatePaymentLink(id) {
      manager();
      const link = links.get(id) ?? h.refuse('No such link', 404, 'not_found');
      const off = { ...link, active: false };
      links.set(id, off);
      return off;
    },
  };
  return { api, links };
}

// ---- Settings › Developers ---------------------------------------------------------------------------

/**
 * Settings › Developers in the mock (pay spec §6), following the merchant side's contract (pay.ts):
 * keys per mode, the publishable one shown in full and the secret once; rolling keeps the old secret
 * working 24 hours; websites checked by `allowedOrigin`; endpoints https with their `whsec_` shown
 * once. Owners and managers only. `micasa` seeds the spec's drawn pane.
 */
export interface DevelopersHost {
  micasa: boolean;
  now: () => string;
  viewer: () => string;
  isManager: (staffId: string) => boolean;
  refuse: (message: string, status?: number, code?: string) => never;
  cardsConnected: () => boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const VERSION = ApiKey.shape.pinnedVersion.options[0];
export const DEVELOPERS_AI = { llmsUrl: 'https://useclear.org/llms.txt', mcpUrl: 'https://useclear.org/docs/mcp.md' } as const;

/** Mi Casa's today, in shop time (America/Los_Angeles), at a wall-clock time. */
const shopToday = (nowIso: string, hhmm: string) => {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(nowIso));
  return new Date(`${day}T${hhmm}:00-07:00`).toISOString();
};

export function createDevelopersMock(h: DevelopersHost) {
  let n = 0;
  const base62 = (len: number) => Array.from({ length: len }, () => BASE62[Math.floor(Math.random() * 62)]).join('');
  const keyId = () => `key_${base62(12)}${++n}`;
  const keys: ApiKey[] = [];
  const sites: AllowedSite[] = [];
  const endpoints: MerchantWebhookEndpoint[] = [];
  let deliveries: WebhookDelivery[] = [];

  const key = (kind: ApiKey['kind'], livemode: boolean, at: string, token: string | null, last4: string): ApiKey => ({
    id: keyId(),
    kind,
    livemode,
    token,
    last4,
    createdAt: at,
    createdBy: h.viewer(),
    rolledAt: null,
    expiresAt: null,
    pinnedVersion: VERSION,
  });
  const publishable = (livemode: boolean, at: string, token = `pk_${livemode ? 'live' : 'test'}_${base62(24)}`) => key('publishable', livemode, at, token, token.slice(-4));
  const secretFor = (livemode: boolean, at: string) => {
    const secret = `sk_${livemode ? 'live' : 'test'}_${base62(24)}`;
    return { key: key('secret', livemode, at, null, secret.slice(-4)), secret };
  };

  if (h.micasa) {
    // The spec's drawn pane: live keys, two websites, one healthy endpoint and its three deliveries.
    const oct12 = '2026-10-12T16:20:00.000Z';
    const oct14 = '2026-10-14T18:05:00.000Z';
    keys.push(
      publishable(true, oct12, 'pk_live_mc8Q2vT4nR7kWb2LxQe9Hs3J'),
      { ...key('secret', true, oct12, null, '9fA2') },
      publishable(false, oct12, 'pk_test_mc5Hd2yP8sLq4Vn6Rt1Zc7Ka'),
      { ...key('secret', false, oct12, null, 'Q7m3') },
    );
    sites.push(
      { origin: 'https://micasatacos.com', addedAt: oct12, addedBy: 'stf_mike', testOnly: false },
      { origin: 'https://order.micasatacos.com', addedAt: oct14, addedBy: 'stf_mike', testOnly: false },
    );
    const endpoint: MerchantWebhookEndpoint = {
      id: 'we_micasa1',
      object: 'webhook_endpoint',
      livemode: true,
      url: 'https://micasatacos.com/clear/webhook',
      events: ['payment.succeeded', 'payment.failed', 'refund.succeeded'],
      status: 'enabled',
      createdAt: oct12,
      health: 'healthy',
      createdBy: 'stf_mike',
    };
    endpoints.push(endpoint);
    const now = h.now();
    deliveries = (
      [
        ['payment.succeeded', 'catering-1042', '10:42'],
        ['payment.succeeded', 'catering-1041', '09:15'],
        ['payment.failed', 'catering-1040', '09:02'],
      ] as const
    ).map(([eventType, reference, hhmm], i) => ({
      id: `whd_micasa${3 - i}`,
      endpointId: endpoint.id,
      eventId: `evt_micasa${3 - i}`,
      eventType,
      reference,
      status: 'succeeded',
      attempts: 1,
      responseCode: 200,
      at: shopToday(now, hhmm),
      nextAttemptAt: null,
    }));
  }

  const manager = () => {
    if (!h.isManager(h.viewer())) h.refuse('Developers is for owners and managers', 403, 'forbidden');
  };
  const live = (k: ApiKey) => !k.expiresAt || Date.parse(k.expiresAt) > Date.parse(h.now());

  const api: Pick<MerchantPayApi, 'developers' | 'createKeys' | 'rollSecretKey' | 'addSite' | 'removeSite' | 'addWebhookEndpoint' | 'removeWebhookEndpoint'> = {
    async developers() {
      manager();
      const shown = keys.filter(live);
      const pk = (livemode: boolean) => shown.find((k) => k.kind === 'publishable' && k.livemode === livemode && !k.rolledAt)?.token;
      const modeOf = new Map(endpoints.map((e) => [e.id, e.livemode]));
      const latest = (livemode: boolean) =>
        deliveries
          .filter((d) => modeOf.get(d.endpointId) === livemode)
          .sort((a, b) => (a.at < b.at ? 1 : -1))
          .slice(0, 20);
      const key = pk(true) ?? pk(false);
      return {
        keys: shown,
        sites: [...sites],
        endpoints: [...endpoints],
        deliveries: [...latest(true), ...latest(false)],
        cardsConnected: h.cardsConnected(),
        ai: { llmsUrl: DEVELOPERS_AI.llmsUrl, prompt: pasteInPrompt(key ?? 'pk_test_…'), mcpUrl: DEVELOPERS_AI.mcpUrl },
      };
    },
    async createKeys(livemode) {
      manager();
      if (keys.some((k) => k.livemode === livemode && !k.rolledAt)) h.refuse(`There are ${livemode ? 'live' : 'test'} keys already`, 409, 'exists');
      const at = h.now();
      const made = secretFor(livemode, at);
      keys.push(publishable(livemode, at), made.key);
      return made;
    },
    async rollSecretKey(id) {
      manager();
      const old = keys.find((k) => k.id === id) ?? h.refuse('No such key', 404, 'not_found');
      if (old.kind !== 'secret') h.refuse('Only a secret key is rolled', 422, 'invalid');
      if (old.rolledAt) h.refuse('That key has been rolled already', 409, 'rolled');
      const at = h.now();
      old.rolledAt = at;
      old.expiresAt = new Date(Date.parse(at) + ROLLED_KEY_HOURS * HOUR_MS).toISOString();
      const made = secretFor(old.livemode, at);
      keys.push(made.key);
      return made;
    },
    async addSite(input) {
      manager();
      const parsed = AddAllowedSite.safeParse(input);
      if (!parsed.success) h.refuse('Type the website’s address', 422, 'invalid');
      const o = allowedOrigin(parsed.data!.site);
      if (!o.ok) return h.refuse(o.reason, 422, 'invalid');
      if (sites.some((s) => s.origin === o.origin)) h.refuse(`${siteLabel(o.origin)} is already on the list`, 409, 'exists');
      const site: AllowedSite = { origin: o.origin, addedAt: h.now(), addedBy: h.viewer(), testOnly: o.testOnly };
      sites.push(site);
      return site;
    },
    async removeSite(origin) {
      manager();
      const i = sites.findIndex((s) => s.origin === origin);
      if (i < 0) h.refuse('That website isn’t on the list', 404, 'not_found');
      sites.splice(i, 1);
    },
    async addWebhookEndpoint(input) {
      manager();
      const parsed = AddWebhookEndpoint.safeParse(input);
      if (!parsed.success) {
        const where = parsed.error.issues[0]?.path[0];
        h.refuse(where === 'events' ? 'Choose at least one event' : 'Use an https address', 422, 'invalid');
      }
      const r = parsed.data!;
      const endpoint: MerchantWebhookEndpoint = {
        id: `we_${base62(14)}`,
        object: 'webhook_endpoint',
        livemode: r.livemode,
        url: r.url,
        events: [...new Set(r.events)],
        status: 'enabled',
        createdAt: h.now(),
        health: 'new',
        createdBy: h.viewer(),
      };
      endpoints.push(endpoint);
      return { endpoint, secret: `whsec_${base62(32)}` };
    },
    async removeWebhookEndpoint(id) {
      manager();
      const i = endpoints.findIndex((e) => e.id === id);
      if (i < 0) h.refuse('No such endpoint', 404, 'not_found');
      endpoints.splice(i, 1);
      deliveries = deliveries.filter((d) => d.endpointId !== id);
    },
  };

  /** The preview's undrawn states (`&screen=no-keys|no-endpoints|no-deliveries`). */
  const preview = (state: 'no-keys' | 'no-endpoints' | 'no-deliveries') => {
    if (state === 'no-keys') keys.splice(0);
    if (state === 'no-endpoints') endpoints.splice(0);
    if (state !== 'no-keys') deliveries = [];
  };
  return { api, preview };
}
