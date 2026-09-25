import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { connectorStore } from '../cards/connectorStore.js';
import * as catalog from '../catalog/catalogService.js';
import { openDrawer } from '../drawer/drawerService.js';
import { updateSettings } from '../shop/shopService.js';
import { setupProgress } from './setupService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const tire = { name: 'Goodyear Assurance', detail: null, category: 'Tires', priceCents: 16200, costCents: 11800, taxKind: 'goods', stockTracked: true, reorderAt: 8 };

describe('set up the till', () => {
  test('a new shop: the team from signup, nothing else', async () => {
    const { merchant } = await seedShop(db);
    expect(await setupProgress(db, merchant)).toEqual({ stripe: false, reader: false, items: false, team: ['Ana', 'Jen', 'Luis'], cash: false, tips: false });
  });

  test('each step, as the shop does it', async () => {
    const { merchant, staff } = await seedShop(db);
    const acct = `acct_setup_${merchant.slice(-6)}`;
    const cc = await connectorStore.insert(db, { merchant, provider: 'stripe', externalAccountId: acct, connectedBy: staff.owner });
    expect((await setupProgress(db, merchant)).stripe).toBe(false);
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    expect((await setupProgress(db, merchant)).stripe).toBe(true);

    await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1, $2, $3, 'stripe', 'smart', $4, 'Front')`, [
      `rdr_setup_${merchant.slice(-6)}`,
      merchant,
      cc.id,
      `tmr_setup_${merchant.slice(-6)}`,
    ]);
    const item = await catalog.createItem(db, { merchant, staffId: staff.manager, item: tire });
    let p = await setupProgress(db, merchant);
    expect([p.reader, p.items]).toEqual([true, true]);
    // An archived catalogue is an empty one.
    await catalog.archiveItem(db, { merchant, itemId: item.id });
    expect((await setupProgress(db, merchant)).items).toBe(false);

    // Tips don't mark starting cash, and the other way round.
    await updateSettings(db, { merchant, staffId: staff.owner, patch: { tips: { enabled: true, mode: 'percentages', presets: [15, 18, 20], goTo: 'raiser' } } });
    p = await setupProgress(db, merchant);
    expect([p.tips, p.cash]).toEqual([true, false]);
    await updateSettings(db, { merchant, staffId: staff.owner, patch: { startingCashCents: 20000 } });
    expect((await setupProgress(db, merchant)).cash).toBe(true);
  });

  test('opening a drawer sets starting cash; a discount code covers tips and discounts', async () => {
    const { merchant, staff } = await seedShop(db);
    await openDrawer(db, { merchant, staffId: staff.jen });
    await catalog.createDiscountCode(db, { merchant, staffId: staff.manager, code: { code: 'FALL10', percent: 10, amountCents: null, appliesTo: { all: true }, startsAt: null, endsAt: null, oncePerCustomer: false } });
    const p = await setupProgress(db, merchant);
    expect([p.cash, p.tips]).toEqual([true, true]);
  });

  test('someone removed is off the team row', async () => {
    const { merchant, staff } = await seedShop(db);
    await db.query('UPDATE merchant.staff SET active = false WHERE id = $1', [staff.luis]);
    expect((await setupProgress(db, merchant)).team).toEqual(['Ana', 'Jen']);
  });
});
