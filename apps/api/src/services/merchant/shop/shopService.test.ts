import { beforeAll, describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { createCardTender } from '../cards/cardTenders.js';
import { connectorStore } from '../cards/connectorStore.js';
import { fakeProvider } from '../cards/fakeProvider.js';
import { connectionToken } from '../cards/terminal.js';
import { getSettings, getShop, ShopError, updateSettings, updateShop } from './shopService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const ADDRESS = { line1: '4120 Market St', line2: null, city: 'Riverside', region: 'ca', postalCode: '92501', country: 'US' };

describe('the shop', () => {
  test('a new shop: no address yet, pay-as-you-go cards, standard Clear pricing', async () => {
    const { merchant } = await seedShop(db);
    expect(await getShop(db, merchant)).toMatchObject({
      id: merchant,
      address: null,
      timezone: 'America/Los_Angeles',
      currency: 'usd',
      cardPlan: { kind: 'payg' },
      clearTier: { tier: 'standard', paidNowBps: 150, overTimeBps: 250 },
    });
    const founding = await seedShop(db, { founding: true });
    await db.query(`UPDATE merchant.profiles SET clear_tier = 'founding' WHERE merchant = $1`, [founding.merchant]);
    expect((await getShop(db, founding.merchant)).clearTier).toEqual({ tier: 'founding', paidNowBps: 125, overTimeBps: 200 });
  });

  test('the owner sets the address, and the reader location follows once there is one', async () => {
    const { merchant, staff } = await seedShop(db);
    const fake = fakeProvider();
    const shop = await updateShop(db, fake.provider, { merchant, patch: { address: ADDRESS, timezone: 'America/Denver' } });
    expect(shop.address).toEqual({ ...ADDRESS, region: 'CA' });
    expect(shop.timezone).toBe('America/Denver');
    expect(fake.calls.locationUpdates).toHaveLength(0);

    await connectorStore.insert(db, { merchant, provider: 'stripe', externalAccountId: 'acct_shop_test', connectedBy: staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: 'acct_shop_test', chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    await connectionToken(db, fake.provider, merchant);
    await updateShop(db, fake.provider, { merchant, patch: { address: { ...ADDRESS, line1: '12 Main St', city: 'Corona', postalCode: '92882' } } });
    expect(fake.calls.locationUpdates).toMatchObject([{ account: 'acct_shop_test', city: 'Corona' }]);
  });

  test('refuses a made-up timezone, a half address, and a non-US address', async () => {
    const { merchant } = await seedShop(db);
    await expect(updateShop(db, null, { merchant, patch: { timezone: 'Mars/Olympus' } })).rejects.toBeInstanceOf(ShopError);
    await expect(updateShop(db, null, { merchant, patch: { address: { line1: '1 Main' } } })).rejects.toBeInstanceOf(ShopError);
    await expect(updateShop(db, null, { merchant, patch: { address: { ...ADDRESS, country: 'CA' } } })).rejects.toMatchObject({ message: 'Clear shops are in the US for now' });
  });
});

describe('settings', () => {
  test('a shop that never changed them gets the defaults', async () => {
    const { merchant } = await seedShop(db);
    const s = await getSettings(db, merchant);
    const { updatedAt, ...rest } = s;
    expect(rest).toEqual(DEFAULT_SETTINGS);
    expect(Date.parse(updatedAt)).not.toBeNaN();
  });

  test('a patch replaces whole groups, keeps the rest, and records who', async () => {
    const { merchant, staff } = await seedShop(db);
    const s = await updateSettings(db, { merchant, staffId: staff.owner, patch: { offlineCards: { enabled: true, limitCents: 25000 }, tips: { enabled: true, mode: 'percentages', presets: [15, 18, 20], goTo: 'raiser' } } });
    expect(s.offlineCards).toEqual({ enabled: true, limitCents: 25000 });
    expect(s.tips.presets).toEqual([15, 18, 20]);
    expect(s.startingCashCents).toBe(15000);
    expect(await getSettings(db, merchant)).toEqual(s);
    const { rows } = await db.query<{ updated_by: string }>('SELECT updated_by FROM merchant.shop_settings WHERE merchant = $1', [merchant]);
    expect(rows[0]!.updated_by).toBe(staff.owner);
  });

  test('refuses settings that don’t make sense together', async () => {
    const { merchant, staff } = await seedShop(db);
    const bad = (patch: unknown) => updateSettings(db, { merchant, staffId: staff.owner, patch });
    await expect(bad({ paymentMethods: { card: false, cash: false, split: false } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(bad({ tips: { enabled: true, mode: 'percentages', presets: [15, 150], goTo: 'raiser' } })).rejects.toMatchObject({ message: 'A tip preset is at most 100%' });
    await expect(bad({ tips: { enabled: true, mode: 'amounts', presets: [500, 500], goTo: 'raiser' } })).rejects.toBeInstanceOf(ShopError);
    await expect(bad({ discountLimits: { counter: 30, manager: 25, owner: null } })).rejects.toMatchObject({ message: 'Counter staff can’t be allowed more off than managers' });
    await expect(bad({ startingCashCents: 12.5 })).rejects.toBeInstanceOf(ShopError);
    await expect(bad({ offlineCards: { enabled: true, limitCents: -1 } })).rejects.toBeInstanceOf(ShopError);
    // Nothing half-applied.
    const { updatedAt, ...rest } = await getSettings(db, merchant);
    expect(rest).toEqual(DEFAULT_SETTINGS);
  });

  test('the card tender carries the offline limit, and card payments turned off are refused by the server', async () => {
    const { merchant, staff } = await seedShop(db);
    const fake = fakeProvider();
    const c = await connectorStore.insert(db, { merchant, provider: 'stripe', externalAccountId: `acct_off_${merchant.slice(-6)}`, connectedBy: staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: c.external_account_id, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1, $2, $3, 'stripe', 'm2', 'STRM2-S', 'M2')`, [`rdr_s_${merchant.slice(-6)}`, merchant, c.id]);
    const order = async () => {
      const id = `ord_s_${Math.random().toString(36).slice(2)}`;
      await db.query(`INSERT INTO commerce.orders (id, merchant, raised_by, subtotal_cents, total_cents, business_date) VALUES ($1, $2, $3, 5000, 5000, '2026-09-24')`, [id, merchant, staff.jen]);
      return id;
    };
    const start = (orderId: string) =>
      createCardTender(db, fake.provider, { merchant, orderId, staffId: staff.jen, amountCents: 5000, tipCents: 0, readerId: `rdr_s_${merchant.slice(-6)}`, idempotencyKey: `k-${Math.random()}` });

    expect((await start(await order())).offlineLimitCents).toBeNull();
    await updateSettings(db, { merchant, staffId: staff.owner, patch: { offlineCards: { enabled: true, limitCents: 25000 } } });
    expect((await start(await order())).offlineLimitCents).toBe(25000);
    await updateSettings(db, { merchant, staffId: staff.owner, patch: { paymentMethods: { card: false, cash: true, split: false } } });
    await expect(start(await order())).rejects.toMatchObject({ code: 'method_off' });
  });
});
