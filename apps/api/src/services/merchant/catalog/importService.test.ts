import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import * as catalog from './catalogService.js';
import { importCatalog } from './importService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const row = (r: Partial<{ name: string; detail: string | null; category: string | null; priceCents: number | null; costCents: number | null; quantity: number | null; reorderAt: number | null }>) => ({
  name: 'Goodyear Assurance',
  detail: '215/55R17',
  category: 'Tires',
  priceCents: 16200,
  costCents: 11800,
  quantity: 8,
  reorderAt: 4,
  ...r,
});

describe('importing a spreadsheet', () => {
  test('new items with their stock; a match adds to stock and changes nothing else', async () => {
    const { merchant, staff } = await seedShop(db);
    const existing = await catalog.createItem(db, { merchant, staffId: staff.manager, item: { name: 'Michelin Defender2', detail: '225/65R17', category: 'Tires', priceCents: 18900, costCents: 13200, taxKind: 'goods', stockTracked: true, reorderAt: 2 } });
    await catalog.adjustStock(db, { merchant, staffId: staff.manager, adjustment: { itemId: existing.id, kind: 'receive', quantity: 3, reason: null } });

    const r = await importCatalog(db, {
      merchant,
      staffId: staff.manager,
      body: {
        rows: [
          row({}),
          // The same item as the shop's, typed differently: its stock goes up; its price doesn't change.
          row({ name: 'michelin  defender2', detail: '225/65r17', priceCents: 99900, quantity: 5 }),
          row({ name: 'Tire rotation', detail: null, category: 'Labour', priceCents: 3500, costCents: null, quantity: null, reorderAt: null }),
          row({ name: 'Valve stem', detail: null, category: null, priceCents: 500, quantity: 40, reorderAt: 10 }),
        ],
      },
    });
    expect(r).toEqual({ created: 3, addedTo: 1, skipped: [] });

    const items = await catalog.listCatalog(db, merchant, { seesCost: true });
    const by = (n: string) => items.find((i) => i.name === n)!;
    expect(by('Michelin Defender2')).toMatchObject({ priceCents: 18900, stock: { onHand: 8 } });
    expect(by('Goodyear Assurance')).toMatchObject({ category: 'Tires', taxKind: 'goods', stockTracked: true, reorderAt: 4, costCents: 11800, stock: { onHand: 8 } });
    expect(by('Tire rotation')).toMatchObject({ category: 'Services', taxKind: 'labour', stockTracked: false, stock: null });
    expect(by('Valve stem')).toMatchObject({ category: 'Parts', stock: { onHand: 40 } });
    const history = await catalog.stockHistory(db, { merchant, itemId: by('Goodyear Assurance').id });
    expect(history[0]).toMatchObject({ kind: 'receive', quantity: 8, reason: 'Imported from a spreadsheet' });
  });

  test('rows that can’t go in are listed with why; the rest still go in', async () => {
    const { merchant, staff } = await seedShop(db);
    const r = await importCatalog(db, {
      merchant,
      staffId: staff.manager,
      body: {
        rows: [
          row({ priceCents: null }),
          row({ name: 'Brake pads', detail: 'Front', category: 'Brakes', priceCents: 8900, quantity: 6 }),
          // Twice in one file: the second adds to the first.
          row({ name: 'Brake pads', detail: 'Front', category: 'Brakes', priceCents: 8900, quantity: 4 }),
          row({ name: 'Alignment', detail: null, category: 'Services', priceCents: 9900, quantity: null }),
          row({ name: 'Alignment', detail: null, category: 'Services', priceCents: 9900, quantity: 3 }),
        ],
      },
    });
    expect(r.created).toBe(2);
    expect(r.addedTo).toBe(1);
    expect(r.skipped).toEqual([
      { row: 1, reason: 'Goodyear Assurance has no price' },
      { row: 5, reason: 'Alignment is a service, which keeps no stock' },
    ]);
    const items = await catalog.listCatalog(db, merchant, { seesCost: true });
    expect(items.find((i) => i.name === 'Brake pads')!.stock!.onHand).toBe(10);
  });

  test('an empty or oversized sheet is refused whole', async () => {
    const { merchant, staff } = await seedShop(db);
    await expect(importCatalog(db, { merchant, staffId: staff.manager, body: { rows: [] } })).rejects.toThrow('The spreadsheet has no rows');
    await expect(importCatalog(db, { merchant, staffId: staff.manager, body: { rows: Array.from({ length: 2001 }, () => row({})) } })).rejects.toThrow('At most 2,000 rows');
  });
});
