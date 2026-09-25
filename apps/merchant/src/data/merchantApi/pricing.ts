import type { TaxKind } from '@clear/merchant-contracts';

/**
 * The server's pricing, for the mock only (apps/api orders/orderService.ts `price`, tax/taxService.ts):
 * a discount comes off before tax, shared across the lines it applies to by largest remainder, and
 * tax is worked out per line on what's left, rounded per line. The live app never prices anything:
 * the server sends totals back. This exists so the mock's orders come to the same cents.
 */

/** Sales tax at Mike's Tire, in parts per million by kind: 7.75% on goods and prepared food. */
export const REFERENCE_RATES_PPM: Record<TaxKind, number> = { goods: 77_500, food: 77_500, labour: 0, exempt: 0 };

/** Splits `discount` across `amounts` in proportion, whole cents, largest remainders first. */
export function allocate(amounts: number[], discount: number): number[] {
  const total = amounts.reduce((s, a) => s + a, 0);
  if (total === 0 || discount === 0) return amounts.map(() => 0);
  const exact = amounts.map((a) => (a * discount) / total);
  const shares = exact.map(Math.floor);
  let left = discount - shares.reduce((s, a) => s + a, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left === 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
}

export interface PricedLine {
  lineCents: number;
  taxKind: TaxKind;
  category: string | null;
}

export interface DiscountSpec {
  percent: number | null;
  amountCents: number | null;
  categories: string[] | null;
}

export function price(lines: PricedLine[], spec: DiscountSpec | null, opts: { inclusive: boolean; rates?: Record<TaxKind, number> }) {
  const rates = opts.rates ?? REFERENCE_RATES_PPM;
  const eligible = lines.map((l) => (!spec || spec.categories === null || (l.category !== null && spec.categories.includes(l.category)) ? l.lineCents : 0));
  const base = eligible.reduce((s, a) => s + a, 0);
  const discount = !spec ? 0 : Math.min(base, spec.percent !== null ? Math.floor((base * spec.percent) / 100) : (spec.amountCents ?? 0));
  const shares = allocate(eligible, discount);
  const taxes = lines.map((l, i) => {
    const amount = l.lineCents - shares[i]!;
    const ppm = rates[l.taxKind];
    return opts.inclusive ? Math.round((amount * ppm) / (1_000_000 + ppm)) : Math.round((amount * ppm) / 1_000_000);
  });
  const gross = lines.reduce((s, l) => s + l.lineCents, 0);
  const tax = taxes.reduce((s, t) => s + t, 0);
  const total = opts.inclusive ? gross - discount : gross - discount + tax;
  const subtotal = opts.inclusive ? total - tax + discount : gross;
  return { shares, taxes, subtotal, discount, tax, total };
}
