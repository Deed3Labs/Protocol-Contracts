import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from '@/data/merchantApi/mock';
import { fromCatalog, historyEntry, shelfAtCost } from './model';

describe('a live shop’s inventory, from the catalog API', () => {
  test('the Goodyear as the list and its page draw it: 6 on the shelf, 2 held, 8 on order', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0 });
    const [catalog, reorders] = await Promise.all([api.catalog(), api.reorders()]);
    const goodyear = fromCatalog(catalog.find((c) => c.id === 'itm_goodyear')!, reorders);
    expect(goodyear).toMatchObject({ kind: 'tire', priceCents: 16200, costCents: 11800, tax: 'goods', stock: { shelf: 6, held: 2, reorderAt: 8, onOrder: 8, supplier: 'Western Tire Supply', due: 'Sat, Sep 26' } });
    expect(goodyear.options?.map((g) => [g.name, g.choices.length])).toEqual([
      ['Road hazard warranty', 3],
      ['Extras', 2],
    ]);
    const mount = fromCatalog(catalog.find((c) => c.id === 'itm_mount')!);
    expect(mount).toMatchObject({ kind: 'service', tax: 'labour' });
    expect(mount.stock).toBeUndefined();
    expect(shelfAtCost(catalog.map((c) => fromCatalog(c)))).toBe(6 * 11800);
  });

  test('stock history reads as the item page’s lines', () => {
    const at = new Date().toISOString();
    expect(historyEntry({ id: 'm1', kind: 'receive', quantity: 8, reason: null, actor: null, orderId: null, reorderId: null, at })).toMatchObject({ what: 'Received', q: '+8', tone: 'in' });
    expect(historyEntry({ id: 'm2', kind: 'damage', quantity: -1, reason: 'Sidewall', actor: null, orderId: null, reorderId: null, at: '2026-09-19T17:00:00Z' })).toEqual({ when: 'Sep 19', what: 'Damaged · Sidewall', q: '−1' });
  });
});
