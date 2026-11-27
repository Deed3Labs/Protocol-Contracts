import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import * as catalog from './catalogService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const tire = { name: 'Goodyear Assurance', detail: '215/55R17 · all-season', category: 'Tires', priceCents: 16200, costCents: 11800, taxKind: 'goods', stockTracked: true, reorderAt: 8 };
const rotation = { name: 'Tire rotation', detail: null, category: 'Labour', priceCents: 3500, costCents: null, taxKind: 'labour', stockTracked: false, reorderAt: null };

describe('items', () => {
  test('added by a manager; cost is there for managers and absent for the counter', async () => {
    const { merchant, staff } = await seedShop(db);
    const item = await catalog.createItem(db, { merchant, staffId: staff.manager, item: tire });
    expect(item).toMatchObject({ name: 'Goodyear Assurance', priceCents: 16200, costCents: 11800, stock: { onHand: 0, held: 0, free: 0 }, optionGroups: [] });
    const counterView = (await catalog.listCatalog(db, merchant, { seesCost: false }))[0]!;
    expect(counterView).not.toHaveProperty('costCents');
    expect(counterView.priceCents).toBe(16200);
  });

  test('a service keeps no stock; changing an item keeps what wasn’t changed; archived items leave the list', async () => {
    const { merchant, staff } = await seedShop(db);
    const svc = await catalog.createItem(db, { merchant, staffId: staff.owner, item: rotation });
    expect(svc.stock).toBeNull();
    const t = await catalog.createItem(db, { merchant, staffId: staff.owner, item: tire });
    const updated = await catalog.updateItem(db, { merchant, itemId: t.id, patch: { priceCents: 16800 } });
    expect(updated).toMatchObject({ priceCents: 16800, costCents: 11800, category: 'Tires', reorderAt: 8 });
    await catalog.archiveItem(db, { merchant, itemId: svc.id });
    expect((await catalog.listCatalog(db, merchant, { seesCost: true })).map((i) => i.id)).toEqual([t.id]);
    await expect(catalog.updateItem(db, { merchant, itemId: svc.id, patch: { priceCents: 1 } })).rejects.toMatchObject({ code: 'archived' });
  });

  test('refuses a fractional price and an unknown tax kind; another shop’s item isn’t found', async () => {
    const { merchant, staff } = await seedShop(db);
    const other = await seedShop(db);
    await expect(catalog.createItem(db, { merchant, staffId: staff.owner, item: { ...tire, priceCents: 16200.5 } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(catalog.createItem(db, { merchant, staffId: staff.owner, item: { ...tire, taxKind: 'luxury' } })).rejects.toMatchObject({ code: 'invalid' });
    const t = await catalog.createItem(db, { merchant, staffId: staff.owner, item: tire });
    await expect(catalog.getItem(db, other.merchant, t.id, true)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('options', () => {
  test('groups and options are saved in order, and saving again replaces them', async () => {
    const { merchant, staff } = await seedShop(db);
    const t = await catalog.createItem(db, { merchant, staffId: staff.owner, item: tire });
    const saved = await catalog.saveOptionGroups(db, {
      merchant,
      itemId: t.id,
      groups: [
        { name: 'Road hazard', rule: 'one', required: false, position: 0, options: [{ name: 'Warranty', deltaCents: 2000, position: 0 }] },
        { name: 'Extras', rule: 'any', required: false, position: 1, options: [{ name: 'Disposal', deltaCents: 300, position: 0 }, { name: 'Valve stem', deltaCents: 500, position: 1 }] },
      ],
    });
    expect(saved.optionGroups.map((g) => [g.name, g.options.map((o) => [o.name, o.deltaCents])])).toEqual([
      ['Road hazard', [['Warranty', 2000]]],
      ['Extras', [['Disposal', 300], ['Valve stem', 500]]],
    ]);
    const again = await catalog.saveOptionGroups(db, { merchant, itemId: t.id, groups: [{ name: 'Extras', rule: 'any', required: false, position: 0, options: [{ name: 'Disposal', deltaCents: 300, position: 0 }] }] });
    expect(again.optionGroups).toHaveLength(1);
  });

  test('a group needs options, each once', async () => {
    const { merchant, staff } = await seedShop(db);
    const t = await catalog.createItem(db, { merchant, staffId: staff.owner, item: tire });
    await expect(catalog.saveOptionGroups(db, { merchant, itemId: t.id, groups: [{ name: 'Empty', rule: 'one', required: true, position: 0, options: [] }] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      catalog.saveOptionGroups(db, { merchant, itemId: t.id, groups: [{ name: 'Dup', rule: 'any', required: false, position: 0, options: [{ name: 'A', deltaCents: 1, position: 0 }, { name: 'a', deltaCents: 2, position: 1 }] }] }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('stock', () => {
  test('receive, damage and a count, each kept in the history with who and why', async () => {
    const { merchant, staff } = await seedShop(db);
    const t = await catalog.createItem(db, { merchant, staffId: staff.owner, item: tire });
    await catalog.adjustStock(db, { merchant, staffId: staff.manager, adjustment: { itemId: t.id, kind: 'receive', quantity: 8, reason: 'from the distributor' } });
    await catalog.adjustStock(db, { merchant, staffId: staff.manager, adjustment: { itemId: t.id, kind: 'damage', quantity: 1, reason: 'sidewall cut' } });
    const counted = await catalog.adjustStock(db, { merchant, staffId: staff.owner, adjustment: { itemId: t.id, kind: 'count', found: 6, reason: null } });
    expect(counted.stock).toEqual({ onHand: 6, held: 0, free: 6 });
    const history = await catalog.stockHistory(db, { merchant, itemId: t.id });
    expect(history.map((h) => [h.kind, h.quantity, h.reason, h.actor])).toEqual([
      ['count', -1, 'was 7, found 6', staff.owner],
      ['damage', -1, 'sidewall cut', staff.manager],
      ['receive', 8, 'from the distributor', staff.manager],
    ]);
  });

  test('a count that finds what the books say moves nothing; damage can’t take more than is there', async () => {
    const { merchant, staff } = await seedShop(db);
    const t = await catalog.createItem(db, { merchant, staffId: staff.owner, item: tire });
    await catalog.adjustStock(db, { merchant, staffId: staff.owner, adjustment: { itemId: t.id, kind: 'receive', quantity: 2, reason: null } });
    await catalog.adjustStock(db, { merchant, staffId: staff.owner, adjustment: { itemId: t.id, kind: 'count', found: 2, reason: null } });
    expect(await catalog.stockHistory(db, { merchant, itemId: t.id })).toHaveLength(1);
    await expect(catalog.adjustStock(db, { merchant, staffId: staff.owner, adjustment: { itemId: t.id, kind: 'damage', quantity: 3, reason: null } })).rejects.toMatchObject({ message: 'Only 2 on the shelf' });
  });

  test('a service can’t take stock; a count says what was found, never a difference', async () => {
    const { merchant, staff } = await seedShop(db);
    const svc = await catalog.createItem(db, { merchant, staffId: staff.owner, item: rotation });
    await expect(catalog.adjustStock(db, { merchant, staffId: staff.owner, adjustment: { itemId: svc.id, kind: 'receive', quantity: 1, reason: null } })).rejects.toMatchObject({ code: 'not_tracked' });
    const t = await catalog.createItem(db, { merchant, staffId: staff.owner, item: tire });
    await expect(catalog.adjustStock(db, { merchant, staffId: staff.owner, adjustment: { itemId: t.id, kind: 'count', quantity: -1, reason: null } })).rejects.toMatchObject({ code: 'invalid' });
  });

  test('two counts at once land one after the other, not on top of each other', async () => {
    const { merchant, staff } = await seedShop(db);
    const t = await catalog.createItem(db, { merchant, staffId: staff.owner, item: tire });
    await catalog.adjustStock(db, { merchant, staffId: staff.owner, adjustment: { itemId: t.id, kind: 'receive', quantity: 10, reason: null } });
    await Promise.all([
      catalog.adjustStock(db, { merchant, staffId: staff.owner, adjustment: { itemId: t.id, kind: 'count', found: 7, reason: null } }),
      catalog.adjustStock(db, { merchant, staffId: staff.manager, adjustment: { itemId: t.id, kind: 'count', found: 7, reason: null } }),
    ]);
    expect((await catalog.getItem(db, merchant, t.id, true)).stock!.onHand).toBe(7);
  });
});

describe('reorders', () => {
  test('marked, part received, then received: each arrival goes on the shelf', async () => {
    const { merchant, staff } = await seedShop(db);
    const t = await catalog.createItem(db, { merchant, staffId: staff.owner, item: tire });
    const r = await catalog.markReordered(db, { merchant, staffId: staff.manager, reorder: { itemId: t.id, quantity: 8, supplier: 'Tire Rack', expectedOn: '2026-09-30' } });
    expect(r).toMatchObject({ status: 'open', expectedOn: '2026-09-30', receivedQuantity: 0 });
    expect((await catalog.receiveReorder(db, { merchant, staffId: staff.manager, reorderId: r.id, quantity: 5 })).status).toBe('partly_received');
    expect((await catalog.receiveReorder(db, { merchant, staffId: staff.manager, reorderId: r.id, quantity: 3 })).status).toBe('received');
    expect((await catalog.getItem(db, merchant, t.id, true)).stock!.onHand).toBe(8);
    const history = await catalog.stockHistory(db, { merchant, itemId: t.id });
    expect(history.every((h) => h.reorderId === r.id && h.reason === 'from Tire Rack')).toBe(true);
    await expect(catalog.receiveReorder(db, { merchant, staffId: staff.manager, reorderId: r.id, quantity: 1 })).rejects.toMatchObject({ code: 'invalid' });
    expect((await catalog.listReorders(db, merchant))[0]!.status).toBe('received');
  });
});

describe('discount codes', () => {
  test('stored upper-case, one per code, a percent or an amount', async () => {
    const { merchant, staff } = await seedShop(db);
    const code = await catalog.createDiscountCode(db, {
      merchant,
      staffId: staff.manager,
      code: { code: 'fall10', percent: 10, amountCents: null, appliesTo: { all: true }, startsAt: null, endsAt: null, oncePerCustomer: false },
    });
    expect(code).toMatchObject({ code: 'FALL10', percent: 10, uses: 0 });
    await expect(
      catalog.createDiscountCode(db, { merchant, staffId: staff.manager, code: { code: 'FALL10', percent: 5, amountCents: null, appliesTo: { all: true }, startsAt: null, endsAt: null, oncePerCustomer: false } }),
    ).rejects.toMatchObject({ code: 'code_taken' });
    await expect(
      catalog.createDiscountCode(db, { merchant, staffId: staff.manager, code: { code: 'BOTH', percent: 5, amountCents: 500, appliesTo: { all: true }, startsAt: null, endsAt: null, oncePerCustomer: false } }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const tires = await catalog.createDiscountCode(db, {
      merchant,
      staffId: staff.manager,
      code: { code: 'TIRES20', percent: null, amountCents: 2000, appliesTo: { categories: ['Tires'] }, startsAt: null, endsAt: null, oncePerCustomer: true },
    });
    expect(tires.appliesTo).toEqual({ categories: ['Tires'] });
    expect((await catalog.listDiscountCodes(db, merchant)).map((c) => c.code).sort()).toEqual(['FALL10', 'TIRES20']);
  });
});
