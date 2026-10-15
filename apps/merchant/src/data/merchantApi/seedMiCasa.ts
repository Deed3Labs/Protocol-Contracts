import { DEFAULT_SETTINGS, type CatalogItem, type DiscountCode, type Reader, type Reorder, type Shop, type ShopSettings, type Staff, type TaxKind } from '@clear/merchant-contracts';
import { CATEGORY_ORDER, MENU } from '../../terminal/reference';
import type { SeedOrder } from './seed';

/**
 * Mi Casa Tacos, the Clear Terminal reference's shop, for the mock (`&shop=micasa`). Everything the
 * mock reads from a seed; what this file doesn't set is Mike's Tire's (the payout position, the
 * reconciliation), which the terminal screens don't draw.
 *
 * The ids of the preview's three roles stay the same as Mike's Tire's (stf_mike is the owner,
 * stf_jen the counter, stf_luis a manager), so `&as=` means the same thing on either shop.
 */
export * from './seed';

export const REFERENCE_DAY = '2026-10-15';
export const YESTERDAY = '2026-10-14';
export const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-07:00`).toISOString();

export const SHOP: Shop = {
  id: '0x4d69436173615461636f730000000000000000a2',
  name: 'Mi Casa Tacos',
  address: {
    line1: '201 E State St',
    line2: null,
    city: 'Redlands',
    region: 'CA',
    postalCode: '92373',
    country: 'US',
  },
  timezone: 'America/Los_Angeles',
  currency: 'usd',
  cardPlan: { kind: 'payg' },
  clearTier: { tier: 'founding', paidNowBps: 125, overTimeBps: 200 },
  listing: {
    category: 'Restaurant',
    oneLine: 'Tacos, al pastor off the trompo',
    phone: '(909) 555-0110',
    email: 'hola@micasatacos.com',
  },
};

/**
 * 8.32% on food. The reference's two bills don't agree on one rate (Table 12's $3.70 is 8.32% of
 * $44.50; order 0142's $3.45 would be 8.17% of $42.25), so Table 12's, which five sections draw,
 * sets it, and order 0142 comes to $45.76 (DECISIONS › Terminal Phase 4).
 */
export const RATES_PPM: Record<TaxKind, number> = {
  goods: 83_200,
  food: 83_200,
  labour: 0,
  exempt: 0,
};

export const STAFF: Staff[] = [
  { id: 'stf_jen', name: 'Jen R.', role: 'counter', active: true },
  { id: 'stf_luis', name: 'Luis M.', role: 'manager', active: true },
  { id: 'stf_mike', name: 'Ana R.', role: 'owner', active: true },
];

export const SHIFTS = [
  { staffId: 'stf_jen', startedAt: at(REFERENCE_DAY, '16:00') },
  { staffId: 'stf_luis', startedAt: at(REFERENCE_DAY, '16:30') },
  { staffId: 'stf_mike', startedAt: at(REFERENCE_DAY, '17:00') },
];

/** Tables on (Settings › Counter): Mi Casa serves at tables. */
export const SETTINGS: ShopSettings = {
  ...DEFAULT_SETTINGS,
  tableService: true,
  updatedAt: at(YESTERDAY, '09:00'),
};

export const itemId = (ref: string) => `itm_${ref}`;

export function catalog(): CatalogItem[] {
  return MENU.map((m) => ({
    id: itemId(m.ref),
    shop: SHOP.id,
    name: m.name,
    detail: m.detail ?? m.note ?? null,
    category: m.category,
    priceCents: m.cents,
    costCents: null,
    taxKind: 'food',
    stockTracked: false,
    stock: null,
    reorderAt: null,
    optionGroups: [],
    archivedAt: null,
    onMenu: m.onMenu,
  }));
}

export { CATEGORY_ORDER };
export const REORDERS: Reorder[] = [];
export const DISCOUNT_CODES: DiscountCode[] = [];

/** The counter's Clear Tap (an M2 in its dock), Table 12's Pay case M2, and Tap to Pay on this tablet. */
export const READERS: Reader[] = [
  {
    id: 'rdr_tap',
    shop: SHOP.id,
    provider: 'stripe',
    type: 'm2',
    externalReaderId: 'STRM2-0C7A',
    label: 'Clear Tap',
    locationId: 'tml_mock',
    lastSeenAt: at(REFERENCE_DAY, '19:58'),
  },
  {
    id: 'rdr_1a3f',
    shop: SHOP.id,
    provider: 'stripe',
    type: 'm2',
    externalReaderId: 'STRM2-1A3F',
    label: 'M2 1A3F',
    locationId: 'tml_mock',
    lastSeenAt: at(REFERENCE_DAY, '19:58'),
  },
  {
    id: 'rdr_ttp',
    shop: SHOP.id,
    provider: 'stripe',
    type: 'tap_to_pay',
    externalReaderId: 'ttp-counter-tablet',
    label: 'Tap to Pay on this tablet',
    locationId: 'tml_mock',
    lastSeenAt: at(REFERENCE_DAY, '19:58'),
  },
];

/** The terminal mock (terminalMock.ts) raises Mi Casa's orders itself, with their tables. */
export const ORDERS: SeedOrder[] = [];

export const CHARGES_THIS_MONTH: Record<string, number> = {
  stf_jen: 41,
  stf_luis: 22,
  stf_mike: 9,
};

export const PROFILE = {
  merchant: SHOP.id,
  name: SHOP.name,
  category: 'Restaurant',
  town: 'Redlands',
  partnerSince: '2026-10-01',
  founding: true,
  payoutTerms: 'Paid on the 14th, and sooner when the pool allows',
};

export const MOCK_PINS: Record<string, string> = {
  '1111': 'stf_jen',
  '2222': 'stf_luis',
  '9999': 'stf_mike',
};
