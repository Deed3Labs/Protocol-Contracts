import { beforeAll, describe, expect, test } from 'bun:test';
import Stripe from 'stripe';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { availabilityFor } from '../cards/cardsService.js';
import { connectorStore } from '../cards/connectorStore.js';
import { cardConnectorHandlers } from './cardConnectorHandlers.js';
import { MAX_ATTEMPTS, processPending, retryDelayMs } from './inbox.js';
import { receiveStripeWebhook } from './webhook.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const SECRET = 'whsec_test_connect';
let seq = 0;

function event(type: string, account: string, object: Record<string, unknown>, opts: { created?: number; livemode?: boolean } = {}): Stripe.Event {
  return {
    id: `evt_test_${++seq}`,
    object: 'event',
    api_version: '2025-08-27.basil',
    created: opts.created ?? Math.floor(Date.now() / 1000),
    livemode: opts.livemode ?? false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    account,
    data: { object },
  } as unknown as Stripe.Event;
}
const accountUpdated = (account: string, charges: boolean, details: boolean, created?: number) =>
  event('account.updated', account, { id: account, object: 'account', charges_enabled: charges, details_submitted: details }, { created });
const deauthorized = (account: string, created?: number) =>
  event('account.application.deauthorized', account, { id: 'ca_clear', object: 'application' }, { created });

/** Through the real endpoint code, with a signature made by Stripe's own library. */
async function deliver(e: Stripe.Event, secret = SECRET) {
  const payload = JSON.stringify(e);
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  return receiveStripeWebhook({ db, endpoint: 'connect', secret, rawBody: Buffer.from(payload), signature });
}
const drain = () => processPending(db, cardConnectorHandlers, { livemode: false });

async function connectedShop() {
  const shop = await seedShop(db);
  const acct = `acct_${Math.random().toString(36).slice(2, 10)}`;
  await connectorStore.insert(db, { merchant: shop.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: shop.staff.owner });
  return { ...shop, acct };
}
const available = (merchant: string) => availabilityFor(db, null, merchant);

describe('the webhook endpoint', () => {
  test('stores a signed event once, and answers a redelivery the same', async () => {
    const e = accountUpdated('acct_x', false, true);
    expect(await deliver(e)).toMatchObject({ status: 200, stored: true });
    expect(await deliver(e)).toMatchObject({ status: 200, stored: false });
    const { rows } = await db.query('SELECT event_id, endpoint, type, account FROM payments.stripe_events WHERE event_id = $1', [e.id]);
    expect(rows).toEqual([{ event_id: e.id, endpoint: 'connect', type: 'account.updated', account: 'acct_x' }]);
  });

  test('refuses a bad signature, a tampered body, and a missing one', async () => {
    const e = accountUpdated('acct_y', true, true);
    expect((await deliver(e, 'whsec_someone_else')).status).toBe(400);
    const payload = JSON.stringify(e);
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
    const tampered = payload.replace('"charges_enabled":true', '"charges_enabled":false');
    expect((await receiveStripeWebhook({ db, endpoint: 'connect', secret: SECRET, rawBody: Buffer.from(tampered), signature })).status).toBe(400);
    expect((await receiveStripeWebhook({ db, endpoint: 'connect', secret: SECRET, rawBody: Buffer.from(payload), signature: undefined })).status).toBe(400);
    const { rows } = await db.query('SELECT 1 FROM payments.stripe_events WHERE event_id = $1', [e.id]);
    expect(rows).toHaveLength(0);
  });

  test('answers 503 when the endpoint is not configured, rather than accepting unverified events', async () => {
    expect((await deliver(accountUpdated('acct_z', true, true), '')).status).toBe(503);
  });
});

describe('processing Connect events', () => {
  test('account.updated opens cards once charges are enabled', async () => {
    const { merchant, acct } = await connectedShop();
    await deliver(accountUpdated(acct, false, true));
    await drain();
    expect(await available(merchant)).toEqual({ available: false, reason: 'charges_disabled' });
    await deliver(accountUpdated(acct, true, true));
    await drain();
    expect(await available(merchant)).toEqual({ available: true });
  });

  test('an older account.updated that arrives late does not undo a newer one', async () => {
    const { merchant, acct } = await connectedShop();
    const now = Math.floor(Date.now() / 1000);
    await deliver(accountUpdated(acct, true, true, now));
    await drain();
    await deliver(accountUpdated(acct, false, false, now - 120));
    await drain();
    expect(await available(merchant)).toEqual({ available: true });
  });

  test('deauthorized locks cards and keeps the history; a late update does not bring it back', async () => {
    const { merchant, acct } = await connectedShop();
    const now = Math.floor(Date.now() / 1000);
    await deliver(accountUpdated(acct, true, true, now - 60));
    await deliver(deauthorized(acct, now));
    await deliver(accountUpdated(acct, true, true, now + 30));
    await drain();
    expect(await available(merchant)).toEqual({ available: false, reason: 'disconnected' });
    expect(await connectorStore.count(db, merchant)).toBe(1);
  });

  test('an event for an account no shop connected changes nothing', async () => {
    await deliver(accountUpdated('acct_stranger', true, true));
    const r = await drain();
    expect(r.failed).toBe(0);
    const { rows } = await db.query(`SELECT 1 FROM merchant.card_connectors WHERE external_account_id = 'acct_stranger'`);
    expect(rows).toHaveLength(0);
  });

  test('a live event in a test environment, or a type nobody handles, is marked done and left alone', async () => {
    const { merchant, acct } = await connectedShop();
    const live = event('account.updated', acct, { id: acct, object: 'account', charges_enabled: true, details_submitted: true }, { livemode: true });
    await deliver(live);
    await deliver(event('customer.created', acct, { id: 'cus_1', object: 'customer' }));
    await drain();
    expect(await available(merchant)).toEqual({ available: false, reason: 'details_pending' });
    const { rows } = await db.query<{ error: string }>('SELECT error FROM payments.stripe_events WHERE event_id = $1', [live.id]);
    expect(rows[0]!.error).toContain('live event in a test environment');
  });

  test('a failing handler backs off, keeps its reason, and stops after the last attempt', async () => {
    const { acct } = await connectedShop();
    const e = accountUpdated(acct, true, true);
    await deliver(e);
    let calls = 0;
    const flaky = { 'account.updated': async () => { calls += 1; throw new Error('Stripe is having a moment'); } };
    let t = Date.now();
    await processPending(db, flaky, { livemode: false, now: new Date(t) });
    // One try per run, and none again until it's due.
    expect(calls).toBe(1);
    await processPending(db, flaky, { livemode: false, now: new Date(t + retryDelayMs(1) - 1000) });
    expect(calls).toBe(1);
    for (let i = 1; i < MAX_ATTEMPTS + 3; i++) {
      t += retryDelayMs(i) + 1000;
      await processPending(db, flaky, { livemode: false, now: new Date(t) });
    }
    expect(calls).toBe(MAX_ATTEMPTS);
    const { rows } = await db.query<{ attempts: number; processed_at: unknown; error: string }>('SELECT attempts, processed_at, error FROM payments.stripe_events WHERE event_id = $1', [e.id]);
    expect(rows[0]).toMatchObject({ attempts: MAX_ATTEMPTS, processed_at: null, error: 'Stripe is having a moment' });
  });

  test('the backoff doubles from 30 seconds and stops at an hour', () => {
    expect([1, 2, 3, 4, 8, 12].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000, 3_600_000, 3_600_000]);
  });

  test("a handler's writes and its event being marked done commit together", async () => {
    const { merchant, acct } = await connectedShop();
    await deliver(accountUpdated(acct, true, true));
    // Writes the status, then fails: nothing it wrote may stick.
    const halfway = {
      'account.updated': async (tx: Parameters<NonNullable<(typeof cardConnectorHandlers)['account.updated']>>[0], ev: Stripe.Event) => {
        await cardConnectorHandlers['account.updated']!(tx, ev);
        throw new Error('crashed after writing');
      },
    };
    await processPending(db, halfway, { livemode: false });
    expect(await available(merchant)).toEqual({ available: false, reason: 'details_pending' });
    // Due again after the backoff.
    await processPending(db, cardConnectorHandlers, { livemode: false, now: new Date(Date.now() + retryDelayMs(1) + 1000) });
    expect(await available(merchant)).toEqual({ available: true });
  });
});
