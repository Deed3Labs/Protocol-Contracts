import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { cardAvailability } from './availability.js';
import { availabilityFor, CardsError, connectCards, STATUS_REFRESH_MS } from './cardsService.js';
import { connectorStore } from './connectorStore.js';
import { fakeProvider } from './fakeProvider.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const APP = 'https://merchant.example/';

describe('card availability', () => {
  test('locked until connected and taking charges, with the reason', () => {
    expect(cardAvailability(null)).toEqual({ available: false, reason: 'not_connected' });
    expect(cardAvailability({ charges_enabled: false, details_submitted: false, disconnected_at: null })).toEqual({ available: false, reason: 'details_pending' });
    expect(cardAvailability({ charges_enabled: false, details_submitted: true, disconnected_at: null })).toEqual({ available: false, reason: 'charges_disabled' });
    expect(cardAvailability({ charges_enabled: true, details_submitted: true, disconnected_at: null })).toEqual({ available: true });
    expect(cardAvailability({ charges_enabled: false, details_submitted: true, disconnected_at: '2026-09-24T00:00:00Z' })).toEqual({ available: false, reason: 'disconnected' });
  });
});

describe('connecting cards', () => {
  test('opens one account, and sends the owner to onboarding that comes back to Settings › Payments', async () => {
    const { merchant, staff } = await seedShop(db);
    const { provider, calls } = fakeProvider();
    const { url } = await connectCards(db, provider, { merchant, staffId: staff.owner, ownerEmail: 'marcus@example.com', appUrl: APP });
    expect(url).toStartWith('https://connect.example/setup/acct_fake_');
    expect(calls.create).toEqual([`clear-card-connect:${merchant}:0`]);
    expect(calls.links[0]).toMatchObject({
      returnUrl: 'https://merchant.example/settings/payments?cards=returned',
      refreshUrl: 'https://merchant.example/settings/payments?cards=refresh',
    });
    expect(await availabilityFor(db, null, merchant)).toEqual({ available: false, reason: 'details_pending' });
  });

  test('pressing it again, or twice at once, reuses the account', async () => {
    const { merchant, staff } = await seedShop(db);
    const { provider, calls } = fakeProvider();
    const input = { merchant, staffId: staff.owner, ownerEmail: null, appUrl: APP };
    await Promise.all([connectCards(db, provider, input), connectCards(db, provider, input)]);
    await connectCards(db, provider, input);
    expect(calls.create).toHaveLength(1);
    expect(new Set(calls.links.map((l) => l.account)).size).toBe(1);
    expect(await connectorStore.count(db, merchant)).toBe(1);
  });

  test('once connected, the owner goes to the processor dashboard instead', async () => {
    const { merchant, staff } = await seedShop(db);
    const { provider } = fakeProvider();
    const input = { merchant, staffId: staff.owner, ownerEmail: null, appUrl: APP };
    await connectCards(db, provider, input);
    const live = (await connectorStore.live(db, merchant))!;
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: live.external_account_id, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    expect(await connectCards(db, provider, input)).toEqual({ url: 'https://dashboard.example/' });
  });

  test('after a disconnect, connecting again opens a fresh account and keeps the old row', async () => {
    const { merchant, staff } = await seedShop(db);
    const { provider, calls } = fakeProvider();
    const input = { merchant, staffId: staff.owner, ownerEmail: null, appUrl: APP };
    await connectCards(db, provider, input);
    const first = (await connectorStore.live(db, merchant))!;
    await connectorStore.markDisconnected(db, { provider: 'stripe', externalAccountId: first.external_account_id, at: new Date() });
    expect(await availabilityFor(db, null, merchant)).toEqual({ available: false, reason: 'disconnected' });
    await connectCards(db, provider, input);
    expect(calls.create).toEqual([`clear-card-connect:${merchant}:0`, `clear-card-connect:${merchant}:1`]);
    expect(await connectorStore.count(db, merchant)).toBe(2);
    expect((await connectorStore.live(db, merchant))!.external_account_id).not.toBe(first.external_account_id);
  });

  test('a merchant with no shop row is refused before any account is opened', async () => {
    const { provider, calls } = fakeProvider();
    await expect(connectCards(db, provider, { merchant: '0xnoshop', staffId: 'x', ownerEmail: null, appUrl: APP })).rejects.toBeInstanceOf(CardsError);
    expect(calls.create).toHaveLength(0);
  });
});

describe('availability after onboarding', () => {
  test('asks the processor when the stored status is stale, not on every call', async () => {
    const { merchant, staff } = await seedShop(db);
    const { provider, calls, status } = fakeProvider();
    await connectCards(db, provider, { merchant, staffId: staff.owner, ownerEmail: null, appUrl: APP });
    const acct = (await connectorStore.live(db, merchant))!.external_account_id;
    status.set(acct, { chargesEnabled: true, detailsSubmitted: true });

    // Just created: fresh, so no call yet.
    expect(await availabilityFor(db, provider, merchant)).toEqual({ available: false, reason: 'details_pending' });
    expect(calls.status).toBe(0);
    // The owner comes back from onboarding a while later.
    const later = new Date(Date.now() + STATUS_REFRESH_MS + 1000);
    expect(await availabilityFor(db, provider, merchant, later)).toEqual({ available: true });
    expect(calls.status).toBe(1);
    // Enabled: nothing more to ask.
    expect(await availabilityFor(db, provider, merchant, new Date(later.getTime() + 60_000))).toEqual({ available: true });
    expect(calls.status).toBe(1);
  });

  test('a processor that cannot be reached leaves the stored answer', async () => {
    const { merchant, staff } = await seedShop(db);
    const { provider } = fakeProvider();
    await connectCards(db, provider, { merchant, staffId: staff.owner, ownerEmail: null, appUrl: APP });
    const down = { ...provider, accountStatus: async () => Promise.reject(new Error('timeout')) };
    expect(await availabilityFor(db, down, merchant, new Date(Date.now() + STATUS_REFRESH_MS * 2))).toEqual({ available: false, reason: 'details_pending' });
  });
});
