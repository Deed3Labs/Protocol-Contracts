import type { TaxKind, TaxStatus } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { connectorStore } from '../cards/connectorStore.js';
import type { TaxAddress, TaxApi, TaxLine } from './taxApi.js';

/**
 * Where a sale's tax comes from (user decision, 2026-09-24):
 *
 *   1. the shop's own Stripe Tax, once it's active there: the shop is liable, and Stripe records it;
 *   2. otherwise the rate for the shop's address, looked up once and kept in Clear's books;
 *   3. with neither, no tax, and the order and Settings say so (`taxSource: 'none'`).
 *
 * Every sale is taxed the same way, Clear included: tax is on the order, not the way it's paid.
 */

export type TaxSource = 'stripe' | 'address_rate' | 'none';
type Rates = Partial<Record<Exclude<TaxKind, 'exempt'>, number | null>>;

interface ShopTaxRow {
  address_line1: string | null;
  address_city: string | null;
  address_region: string | null;
  address_postal_code: string | null;
  address_country: string;
  tax_rates: Rates | string | null;
  tax_rates_address: string | null;
}

const addressOf = (r: ShopTaxRow): TaxAddress | null =>
  r.address_line1 && r.address_city && r.address_region && r.address_postal_code
    ? { line1: r.address_line1, city: r.address_city, region: r.address_region, postalCode: r.address_postal_code, country: r.address_country }
    : null;
const addressKey = (a: TaxAddress) => [a.line1, a.city, a.region, a.postalCode, a.country].join('|').toLowerCase();

async function shopTax(q: Queryable, merchant: string): Promise<ShopTaxRow> {
  const { rows } = await q.query<ShopTaxRow>(
    'SELECT address_line1, address_city, address_region, address_postal_code, address_country, tax_rates, tax_rates_address FROM merchant.profiles WHERE merchant = $1',
    [merchant],
  );
  if (!rows[0]) throw new Error('No such shop');
  return rows[0];
}

/** A shop account's Stripe Tax readiness, remembered for a while: checkout asks on every cart change. */
const statusCache = new Map<string, { status: 'active' | 'setup_needed'; at: number }>();
const STATUS_TTL_MS = 10 * 60 * 1000;

async function stripeReady(api: TaxApi, account: string): Promise<boolean> {
  const hit = statusCache.get(account);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.status === 'active';
  const status = await api.status(account).catch(() => 'setup_needed' as const);
  statusCache.set(account, { status, at: Date.now() });
  return status === 'active';
}

export function forgetTaxStatus(account?: string) {
  if (account) statusCache.delete(account);
  else statusCache.clear();
}

/**
 * The rate for the shop's address, by kind of item, from Clear's own Stripe Tax (it calculates;
 * nothing is recorded there). Kept on the shop, and looked up again when the address changes.
 * A kind Stripe isn't collecting for there comes back null: unknown, not 0%.
 */
export async function lookupAddressRates(db: Queryable, api: TaxApi, merchant: string): Promise<Rates | null> {
  const shop = await shopTax(db, merchant);
  const address = addressOf(shop);
  if (!address) return null;
  const kinds = ['goods', 'labour', 'food'] as const;
  const calc = await api.calculate(null, { address, inclusive: false, lines: kinds.map((k) => ({ reference: k, amountCents: 10_000, taxKind: k })) });
  const rates: Rates = Object.fromEntries(kinds.map((k) => [k, calc.rateByLine.get(k) ?? null]));
  await db.query('UPDATE merchant.profiles SET tax_rates = $2, tax_rates_address = $3, tax_rates_at = now() WHERE merchant = $1', [merchant, JSON.stringify(rates), addressKey(address)]);
  return rates;
}

function storedRates(shop: ShopTaxRow): Rates | null {
  const address = addressOf(shop);
  if (!address || !shop.tax_rates || shop.tax_rates_address !== addressKey(address)) return null;
  return typeof shop.tax_rates === 'string' ? (JSON.parse(shop.tax_rates) as Rates) : shop.tax_rates;
}

/** Tax on a line at a known rate, in whole cents, rounded half up. Inclusive: the part of the price that is tax. */
export function taxAtRate(amountCents: number, ratePpm: number, inclusive: boolean): number {
  if (ratePpm <= 0 || amountCents <= 0) return 0;
  return inclusive ? Math.round((amountCents * ratePpm) / (1_000_000 + ratePpm)) : Math.round((amountCents * ratePpm) / 1_000_000);
}

export interface OrderTax {
  source: TaxSource;
  calculationId: string | null;
  taxByLine: Map<string, number>;
}

/**
 * The tax on an order's lines (amounts after discount). Uses the shop's Stripe Tax when it's
 * active; if Stripe can't be reached or can't place the address, falls back to the address rate
 * rather than failing the sale.
 */
export async function taxForOrder(db: Queryable, api: TaxApi | null, input: { merchant: string; lines: TaxLine[]; inclusive: boolean }): Promise<OrderTax> {
  const shop = await shopTax(db, input.merchant);
  const address = addressOf(shop);
  const zero = (source: TaxSource): OrderTax => ({ source, calculationId: null, taxByLine: new Map(input.lines.map((l) => [l.reference, 0])) });
  if (!address) return zero('none');
  if (input.lines.every((l) => l.taxKind === 'exempt' || l.amountCents === 0)) return zero(storedRates(shop) ? 'address_rate' : 'none');

  const live = await connectorStore.live(db, input.merchant);
  if (api && live && (await stripeReady(api, live.external_account_id))) {
    try {
      const calc = await api.calculate(live.external_account_id, { address, lines: input.lines, inclusive: input.inclusive });
      return { source: 'stripe', calculationId: calc.calculationId, taxByLine: calc.taxByLine };
    } catch (error) {
      console.warn('Stripe Tax calculation failed; using the address rate:', error instanceof Error ? error.message : error);
    }
  }

  let rates = storedRates(shop);
  if (!rates && api) rates = await lookupAddressRates(db, api, input.merchant).catch(() => null);
  if (!rates) return zero('none');
  const known = input.lines.every((l) => l.taxKind === 'exempt' || (rates![l.taxKind] ?? null) !== null);
  if (!known) return zero('none');
  return {
    source: 'address_rate',
    calculationId: null,
    taxByLine: new Map(input.lines.map((l) => [l.reference, l.taxKind === 'exempt' ? 0 : taxAtRate(l.amountCents, rates![l.taxKind] ?? 0, input.inclusive)])),
  };
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : (v / 10_000).toFixed(4).replace(/\.?0+$/, ''));

/** Settings › Tax. */
export async function taxStatus(db: Queryable, api: TaxApi | null, merchant: string): Promise<TaxStatus> {
  const shop = await shopTax(db, merchant);
  const { rows } = await db.query<{ prices_include_tax: boolean }>('SELECT prices_include_tax FROM merchant.shop_settings WHERE merchant = $1', [merchant]);
  const live = await connectorStore.live(db, merchant);
  const stripe: TaxStatus['stripe'] = !live ? 'not_connected' : api && (await stripeReady(api, live.external_account_id)) ? 'active' : 'setup_needed';
  let rates = storedRates(shop);
  if (!rates && api && addressOf(shop)) rates = await lookupAddressRates(db, api, merchant).catch(() => null);
  const hasRate = rates && Object.values(rates).some((r) => r !== null && r !== undefined);
  return {
    source: stripe === 'active' ? 'stripe' : hasRate ? 'address_rate' : 'none',
    stripe,
    rates: { goods: pct(rates?.goods), labour: pct(rates?.labour), food: pct(rates?.food) },
    pricesIncludeTax: rows[0]?.prices_include_tax ?? false,
  };
}
