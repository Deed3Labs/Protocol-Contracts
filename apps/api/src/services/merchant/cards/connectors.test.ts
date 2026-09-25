import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { safetyCaptureAfterMs } from '../../../jobs/cardCaptureSafety.js';
import { createOrder, type OrderDeps } from '../orders/orderService.js';
import { cancelCardTender, captureDue, createCardTender, syncCardTender } from './cardTenders.js';
import { connectorStore } from './connectorStore.js';
import { fakeProvider } from './fakeProvider.js';
import { cardConnector, cardConnectors, connectorForShop, setCardConnectorsForTest } from './registry.js';
import { NotBuilt, squareConnector } from './squareConnector.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});
afterEach(() => setCardConnectorsForTest(null));

let seq = 0;
const key = () => `cn-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const deps: OrderDeps = { taxApi: null, pinCheck: async () => null };
const HOUR = 60 * 60 * 1000;

/** A shop connected through `provider`, with a reader, and a card sale tapped and authorised. */
async function shopOn(provider: 'stripe' | 'square') {
  const s = await seedShop(db);
  const fake = fakeProvider({ provider });
  const acct = `acct_cn_${s.merchant.slice(-6)}`;
  const cc = await connectorStore.insert(db, { merchant: s.merchant, provider, externalAccountId: acct, connectedBy: s.staff.owner });
  await connectorStore.applyStatus(db, { provider, externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
  const reader = `rdr_cn_${s.merchant.slice(-6)}`;
  await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1,$2,$3,$4,'smart',$5,'Front')`, [reader, s.merchant, cc.id, provider, `tmr-${reader}`]);
  const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'Tires', note: null, amountCents: 5000, taxKind: 'goods' }] });
  const start = await createCardTender(db, fake.provider, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, amountCents: 5000, tipCents: 0, readerId: reader, idempotencyKey: key() });
  fake.tap([...fake.payments.keys()].at(-1)!);
  await syncCardTender(db, fake.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: null });
  return { ...s, fake, tenderId: start.tenderId };
}

describe('the registry', () => {
  test('a shop is served by the processor it connected with; a new shop is sent to Stripe', async () => {
    const stripe = fakeProvider({ provider: 'stripe' });
    const square = fakeProvider({ provider: 'square' });
    setCardConnectorsForTest({ stripe: stripe.provider, square: square.provider });

    const onSquare = await shopOn('square');
    expect(await connectorForShop(db, onSquare.merchant)).toBe(square.provider);
    const fresh = await seedShop(db);
    expect(await connectorForShop(db, fresh.merchant)).toBe(stripe.provider);
    expect(cardConnectors().map((c) => c.provider)).toEqual(['stripe', 'square']);
  });

  test('Square isn’t handed out until it’s built, and a shop on a processor this server lacks gets none', async () => {
    setCardConnectorsForTest(null);
    expect(cardConnector('square')).toBeNull();
    setCardConnectorsForTest({ stripe: fakeProvider().provider });
    const onSquare = await shopOn('square');
    setCardConnectorsForTest({ stripe: fakeProvider().provider, square: null });
    expect(await connectorForShop(db, onSquare.merchant)).toBeNull();
  });

  test('only the registry picks a connector: nothing outside the connectors imports Stripe’s', () => {
    const src = join(import.meta.dir, '../../..');
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.ts') && !d.name.endsWith('.test.ts') ? [join(dir, d.name)] : []));
    const importers = files(src)
      .filter((f) => /from '[^']*cards\/stripeConnector\.js'|from '\.\/stripeConnector\.js'/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(src.length + 1))
      .sort();
    // The registry, and Stripe's own webhook adapter (livemode, refund snapshots).
    expect(importers).toEqual(['jobs/stripeEventProcessor.ts', 'services/merchant/cards/registry.ts', 'services/merchant/stripeEvents/cardPaymentHandlers.ts']);
  });
});

describe('the Square stub', () => {
  test('says what Square is, and refuses every call pointing at the note', async () => {
    const sq = squareConnector();
    expect(sq).toMatchObject({ provider: 'square', supportsPlatformFee: true, authorisationHoldMs: 36 * HOUR });
    await expect(sq.createPayment('acct', { amountCents: 100, applicationFeeCents: 0, metadata: {}, idempotencyKey: 'k' })).rejects.toBeInstanceOf(NotBuilt);
    await expect(sq.listPayouts('acct', new Date())).rejects.toThrow('SQUARE.md');
    expect(() => sq.dashboardUrl('acct')).toThrow(NotBuilt);
  });

  test('the safety capture acts 12 hours inside each processor’s hold', () => {
    expect(safetyCaptureAfterMs(fakeProvider().provider)).toBe(36 * HOUR);
    expect(safetyCaptureAfterMs(squareConnector())).toBe(24 * HOUR);
  });
});

describe('a payment stays with the processor that took it', () => {
  test('another processor can’t void it, and capture runs only over its own', async () => {
    const onSquare = await shopOn('square');
    const stripe = fakeProvider({ provider: 'stripe' });
    await expect(cancelCardTender(db, stripe.provider, { merchant: onSquare.merchant, tenderId: onSquare.tenderId, actor: onSquare.staff.jen, canVoidAuthorised: true })).rejects.toMatchObject({ code: 'wrong_state' });
    expect(stripe.calls.cancels).toEqual([]);

    expect((await captureDue(db, stripe.provider, { merchant: onSquare.merchant })).captured).toEqual([]);
    expect((await captureDue(db, onSquare.fake.provider, { merchant: onSquare.merchant })).captured).toEqual([onSquare.tenderId]);
  });

  test('a card sale is refused on a connector other than the shop’s', async () => {
    const onSquare = await shopOn('square');
    const o = await createOrder(db, deps, { merchant: onSquare.merchant, staffId: onSquare.staff.jen, lines: [{ itemId: null, name: 'Patch', note: null, amountCents: 1800, taxKind: 'labour' }] });
    const { rows } = await db.query<{ id: string }>('SELECT id FROM merchant.readers WHERE merchant = $1', [onSquare.merchant]);
    await expect(
      createCardTender(db, fakeProvider({ provider: 'stripe' }).provider, { merchant: onSquare.merchant, orderId: o.id, staffId: onSquare.staff.jen, amountCents: 1800, tipCents: 0, readerId: rows[0]!.id, idempotencyKey: key() }),
    ).rejects.toThrow('takes cards through square');
  });
});
