import { CreatePaymentLink, type CatalogItem, type MerchantPaymentLink, type MerchantPayApi, type TaxKind } from '@clear/merchant-contracts';
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
