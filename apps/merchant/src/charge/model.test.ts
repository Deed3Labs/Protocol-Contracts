import { describe, expect, test } from 'bun:test';
import { FALL10, REFERENCE_CART, lineOf, totals, type CartLine } from './model';

/** The reference's own figures, from docs/merchant-reference/clear-merchant-new-charge.html. */
describe('cart totals', () => {
  test('the reference cart is $927.52 with $59.52 of tax on the parts', () => {
    const t = totals(REFERENCE_CART);
    expect(t.count).toBe(9);
    expect(t.goodsCents).toBe(76800);
    expect(t.labourCents).toBe(10000);
    expect(t.taxCents).toBe(5952);
    expect(t.totalCents).toBe(92752);
  });

  test('FALL10 comes off before tax: $86.80 off, $834.77', () => {
    const t = totals(REFERENCE_CART, FALL10);
    expect(t.discountCents).toBe(8680);
    expect(t.goodsCents).toBe(69120);
    expect(t.labourCents).toBe(9000);
    expect(t.taxCents).toBe(5357);
    expect(t.totalCents).toBe(83477);
  });

  test('15% off is $130.20, leaving $788.39', () => {
    const t = totals(REFERENCE_CART, { label: '15%', percent: 15 });
    expect(t.discountCents).toBe(13020);
    expect(t.totalCents).toBe(78839);
  });

  test('four tires alone are $814.59', () => {
    expect(totals([lineOf('michelin', 4)]).totalCents).toBe(81459);
  });

  test('a food truck order taxes prepared food: $37.71', () => {
    const lines: CartLine[] = [
      { key: 'tacos', name: 'Street tacos, 3', qty: 2, unitCents: 1100, tax: 'food' },
      { key: 'chips', name: 'Chips and salsa', qty: 1, unitCents: 500, tax: 'food' },
      { key: 'agua', name: 'Agua fresca', qty: 2, unitCents: 400, tax: 'food' },
    ];
    const t = totals(lines);
    expect(t.taxCents).toBe(271);
    expect(t.totalCents).toBe(3771);
  });
});
