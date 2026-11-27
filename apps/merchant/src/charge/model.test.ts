import { describe, expect, test } from 'bun:test';
import { CATALOG, FALL10, REFERENCE_CART, TILE_ORDER, lineOf, tilesFor, totals, type CartLine, type Item } from './model';

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

describe('Item tiles', () => {
  const item = (id: string, name: string, extra: Partial<Item> = {}): Item => ({ id, name, detail: '', category: 'Beauty', thumb: 'part', priceCents: 2500, tax: 'goods', ...extra });
  const shop = [item('itm_1', 'Silk press'), item('itm_2', 'Edge control', { stock: { free: 0 } }), item('itm_3', 'Braids', { category: 'Hair' })];
  const names = (items: Item[]) => items.map((i) => i.name);

  test('a live shop’s tiles are its catalogue, not the reference’s layout', () => {
    // The reference layout names items this shop doesn't have: it must not empty the grid.
    expect(names(tilesFor(shop, 'All', TILE_ORDER))).toEqual(['Silk press', 'Braids']);
    expect(names(tilesFor(shop, 'All'))).toEqual(['Silk press', 'Braids']);
  });

  test('a layout that names the items orders them, still without what is out of stock; a tab is its category', () => {
    expect(names(tilesFor(shop, 'All', ['itm_3', 'itm_2', 'itm_1']))).toEqual(['Braids', 'Silk press']);
    expect(names(tilesFor(shop, 'Hair', ['itm_1']))).toEqual(['Braids']);
  });

  test('the reference layout still draws the reference catalogue', () => {
    expect(tilesFor(CATALOG, 'All', TILE_ORDER).map((i) => i.id)).toEqual(TILE_ORDER.filter((id) => CATALOG.some((i) => i.id === id && !(i.stock && i.stock.free <= 0))));
  });
});
