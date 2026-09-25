import type { TaxKind } from '@clear/merchant-contracts';
import Stripe from 'stripe';

/**
 * Stripe Tax, as checkout needs it (card-processing prompt, Phase 6). Checked against Stripe's docs
 * on 2026-09-24:
 *
 * - **The shop is liable** (a software platform, Standard accounts), so calculations run on the
 *   shop's own account (`Stripe-Account`), and only once its tax settings are `active` (head
 *   office, preset code and a registration). docs.stripe.com/tax/tax-for-platforms
 * - **No registration where the sale happens: zero tax** (`taxability_reason: not_collecting`),
 *   which is read here as "not known", never as "0%". docs.stripe.com/tax/zero-tax
 * - **In person, the customer's location is the shop.** US addresses need at least a postal code.
 * - **A calculation becomes a transaction after payment** (`create_from_calculation`, within 90
 *   days, with a unique reference), and refunds are reversals. docs.stripe.com/tax/off-stripe
 * - **Cost** on the API: 50¢ per transaction, including 10 calculation calls, then 5¢ per call.
 *   So checkout calculates once per change to the cart, never per keystroke. stripe.com/tax/pricing
 * - **Test mode** is capped at 1,000 calculations a day.
 */

/** How each kind of item is taxed, as Stripe's product tax codes. */
export const TAX_CODES: Record<TaxKind, string> = {
  goods: 'txcd_99999999', // General - Tangible Goods
  labour: 'txcd_20030000', // General - Services
  food: 'txcd_40060003', // Food for Immediate Consumption
  exempt: 'txcd_00000000', // Nontaxable
};

export interface TaxAddress {
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface TaxLine {
  reference: string;
  amountCents: number;
  taxKind: TaxKind;
}

export interface Calculation {
  calculationId: string;
  /** Tax per line reference, in cents. */
  taxByLine: Map<string, number>;
  /** Rate per line reference in millionths, where the jurisdiction collects; null where it doesn't. */
  rateByLine: Map<string, number | null>;
}

export interface TaxApi {
  /** A shop account's Stripe Tax: ready to calculate, or still being set up. */
  status(account: string): Promise<'active' | 'setup_needed'>;
  /** `account` null: Clear's own account, used only to look up the rate for an address. */
  calculate(account: string | null, input: { address: TaxAddress; lines: TaxLine[]; inclusive: boolean }): Promise<Calculation>;
}

const ppm = (percentageDecimal: string) => Math.round(Number(percentageDecimal) * 10_000);

export function stripeTaxApi(stripe: Stripe): TaxApi {
  return {
    async status(account) {
      const settings = await stripe.tax.settings.retrieve({}, { stripeAccount: account });
      return settings.status === 'active' ? 'active' : 'setup_needed';
    },

    async calculate(account, { address, lines, inclusive }) {
      const calc = await stripe.tax.calculations.create(
        {
          currency: 'usd',
          line_items: lines.map((l) => ({
            amount: l.amountCents,
            reference: l.reference,
            tax_code: TAX_CODES[l.taxKind],
            tax_behavior: inclusive ? 'inclusive' : 'exclusive',
          })),
          customer_details: {
            address: { line1: address.line1, city: address.city, state: address.region, postal_code: address.postalCode, country: address.country },
            address_source: 'billing',
          },
          expand: ['line_items.data.tax_breakdown'],
        },
        account ? { stripeAccount: account } : {},
      );
      const taxByLine = new Map<string, number>();
      const rateByLine = new Map<string, number | null>();
      for (const li of calc.line_items?.data ?? []) {
        taxByLine.set(li.reference, li.amount_tax);
        const parts = li.tax_breakdown ?? [];
        const notCollecting = parts.some((b) => b.taxability_reason === 'not_collecting');
        rateByLine.set(li.reference, notCollecting ? null : parts.reduce((sum, b) => sum + (b.tax_rate_details ? ppm(b.tax_rate_details.percentage_decimal) : 0), 0));
      }
      return { calculationId: calc.id!, taxByLine, rateByLine };
    },
  };
}

export function defaultTaxApi(): TaxApi | null {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  return key ? stripeTaxApi(new Stripe(key)) : null;
}
