import { beforeAll, describe, expect, test } from 'bun:test';
import type Stripe from 'stripe';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { captureCardTender, createCardTender, syncCardTender } from '../cards/cardTenders.js';
import { connectorStore } from '../cards/connectorStore.js';
import { fakeProvider } from '../cards/fakeProvider.js';
import { openDrawer } from '../drawer/drawerService.js';
import { balance } from '../ledger/ledgerService.js';
import { createOrder, type OrderDeps } from '../orders/orderService.js';
import { createCashTender } from '../orders/payments.js';
import { requestRefund } from '../orders/refunds.js';
import { overview } from '../overview.js';
import { cardPaymentHandlers } from '../stripeEvents/cardPaymentHandlers.js';
import { processPending, recordEvent } from '../stripeEvents/inbox.js';
import { breakdown, cardDeposits, syncPayout, syncRecentPayouts } from './payoutSync.js';
import { findMismatches, openFlags, reconcileAll } from './reconcile.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

let seq = 0;
const key = () => `po-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const deps: OrderDeps = { taxApi: null, pinCheck: async () => null };
const SINCE = new Date(Date.now() - 86_400_000);

/** A shop taking cards, with a helper that sells on a card and captures it. */
async function shop() {
  const s = await seedShop(db);
  const fake = fakeProvider();
  const acct = `acct_po_${s.merchant.slice(-6)}`;
  const cc = await connectorStore.insert(db, { merchant: s.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: s.staff.owner });
  await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
  const reader = `rdr_po_${s.merchant.slice(-6)}`;
  await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1,$2,$3,'stripe','m2',$4,'M2')`, [reader, s.merchant, cc.id, `M2-${reader}`]);
  const sellCard = async (amountCents: number, tipCents = 0) => {
    const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'Tires', note: null, amountCents, taxKind: 'goods' }] });
    const start = await createCardTender(db, fake.provider, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, amountCents, tipCents, readerId: reader, idempotencyKey: key() });
    const pi = [...fake.payments.keys()].at(-1)!;
    fake.tap(pi);
    await syncCardTender(db, fake.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: null });
    await captureCardTender(db, fake.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: null });
    return { orderId: o.id, tenderId: start.tenderId, pi };
  };
  const sync = (payoutId: string) => db.transaction((tx) => syncPayout(tx, fake.provider, { merchant: s.merchant, connectorId: cc.id, account: acct, payoutId }));
  return { ...s, fake, acct, connectorId: cc.id, sellCard, sync };
}

describe('card deposits', () => {
  test('a payout, from Stripe’s own fee data: the processor’s fee and Clear’s apart, booked when it reaches the bank', async () => {
    const s = await shop();
    await s.sellCard(9800); // Stripe 2.7% + 5¢ = $2.70, Clear 30¢
    await s.sellCard(10000, 800); // on $108.00: Stripe $2.97, Clear 30¢
    const p = s.fake.payout('in_transit');
    await s.sync(p.id);
    const [dep] = await cardDeposits(db, { merchant: s.merchant, from: '1970-01-01', to: '9999-12-31' });
    expect(dep).toEqual({ id: p.id, shop: s.merchant, externalPayoutId: p.id, arrivalDate: '2026-09-28', grossCents: 20600, processorFeeCents: 270 + 297, clearFeeCents: 60, netCents: 20600 - 567 - 60, chargeCount: 2, status: 'in_transit' });
    // Not in the bank yet: nothing booked.
    expect(await balance(db, s.merchant, 'bank')).toBe(0);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(20600);

    s.fake.setPayoutStatus(p.id, 'paid');
    await s.sync(p.id);
    await s.sync(p.id);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(0);
    expect(await balance(db, s.merchant, 'bank')).toBe(19973);
    expect(await balance(db, s.merchant, 'card_processing_expense')).toBe(627);
  });

  test('refunds net out of the payout; a dispute is booked as card processing', async () => {
    const s = await shop();
    const a = await s.sellCard(10000);
    const r = await requestRefund(db, { card: s.fake.provider, pinCheck: deps.pinCheck }, {
      merchant: s.merchant,
      staff: { id: s.staff.owner, role: 'owner' },
      request: { tenderId: a.tenderId, amountCents: 2000, items: [], reason: null, idempotencyKey: key() },
    });
    expect(r.status).toBe('succeeded');
    s.fake.adjust(-1500); // a dispute's fee
    const p = s.fake.payout('paid');
    await s.sync(p.id);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(0);
    expect(await balance(db, s.merchant, 'bank')).toBe(p.amountCents);
    expect(await balance(db, s.merchant, 'card_processing_expense')).toBe(275 + 30 + 1500);
  });

  test('a paid payout that then fails is undone; one that doesn’t add up is shown, never booked', async () => {
    const s = await shop();
    await s.sellCard(5000);
    const p = s.fake.payout('paid');
    await s.sync(p.id);
    expect(await balance(db, s.merchant, 'bank')).toBe(p.amountCents);
    s.fake.setPayoutStatus(p.id, 'failed');
    await s.sync(p.id);
    expect(await balance(db, s.merchant, 'bank')).toBe(0);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(5000);

    await s.sellCard(3000);
    const off = s.fake.payout('paid', { amountOffCents: 100 });
    await s.sync(off.id);
    const { rows } = await db.query<{ breakdown_ok: boolean }>('SELECT breakdown_ok FROM payments.card_payouts WHERE id = $1', [off.id]);
    expect(rows[0]!.breakdown_ok).toBe(false);
    expect(await balance(db, s.merchant, 'bank')).toBe(0);
  });

  test('the payout webhook syncs it, once however often it arrives; the sweep finds the rest', async () => {
    const s = await shop();
    await s.sellCard(9800);
    const p = s.fake.payout('paid');
    const event = (id: string) => ({ id, object: 'event', type: 'payout.paid', account: s.acct, created: 1, livemode: false, data: { object: { id: p.id, object: 'payout' } } }) as unknown as Stripe.Event;
    await recordEvent(db, 'connect', event(`evt_po1_${p.id}`));
    await recordEvent(db, 'connect', event(`evt_po2_${p.id}`));
    const r = await processPending(db, cardPaymentHandlers(() => s.fake.provider), { livemode: false });
    expect(r.failed).toBe(0);
    expect(await balance(db, s.merchant, 'bank')).toBe(p.amountCents);

    await s.sellCard(2000);
    const q = s.fake.payout('paid');
    await syncRecentPayouts(db, s.fake.provider, { since: SINCE, merchant: s.merchant });
    expect(await balance(db, s.merchant, 'bank')).toBe(p.amountCents + q.amountCents);
  });

  test('the breakdown adds items the way the processor does', () => {
    const b = breakdown([
      { id: 'a', type: 'charge', amountCents: 10000, processorFeeCents: 275, platformFeeCents: 30, netCents: 9695, paymentId: 'pi', createdAt: '' },
      { id: 'b', type: 'refund', amountCents: -2000, processorFeeCents: 0, platformFeeCents: 0, netCents: -2000, paymentId: 'pi', createdAt: '' },
      { id: 'c', type: 'adjustment', amountCents: -1500, processorFeeCents: 0, platformFeeCents: 0, netCents: -1500, paymentId: null, createdAt: '' },
    ]);
    expect(b).toEqual({ grossCents: 8000, processorFeeCents: 275, clearFeeCents: 30, otherCents: -1500, chargeCount: 1, netCents: 6195 });
  });
});

describe('the nightly reconciliation', () => {
  test('books that agree raise nothing', async () => {
    const s = await shop();
    await s.sellCard(9800);
    const p = s.fake.payout('paid');
    await s.sync(p.id);
    expect(await findMismatches(db, s.fake.provider, { merchant: s.merchant, account: s.acct, since: SINCE })).toEqual([]);
  });

  test('flags a charge with no tender, a tender with no charge, a wrong amount and a wrong fee; closes them once fixed', async () => {
    const s = await shop();
    const a = await s.sellCard(9800);
    const b = await s.sellCard(5000);
    // Stripe took money nobody rang up; our tender a says a different amount and fee than its charge.
    s.fake.balance.push({ id: 'txn_stray', type: 'charge', amountCents: 4200, processorFeeCents: 118, platformFeeCents: 0, netCents: 4082, paymentId: 'pi_stray', createdAt: new Date().toISOString(), payoutId: null });
    await db.query('UPDATE payments.tenders SET amount_cents = 9900, application_fee_cents = 25 WHERE id = $1', [a.tenderId]);
    // And b's charge is missing from Stripe.
    const idx = s.fake.balance.findIndex((x) => x.paymentId === b.pi);
    const [removed] = s.fake.balance.splice(idx, 1);

    await reconcileAll(db, s.fake.provider, { since: SINCE, merchant: s.merchant });
    const kinds = (await openFlags(db, s.merchant)).map((f) => f.kind).sort();
    expect(kinds).toEqual(['amount_mismatch', 'charge_without_tender', 'fee_mismatch', 'tender_without_charge']);
    // A second run doesn't duplicate them.
    await reconcileAll(db, s.fake.provider, { since: SINCE, merchant: s.merchant });
    expect(await openFlags(db, s.merchant)).toHaveLength(4);

    // Put it right: the flags close themselves.
    await db.query('UPDATE payments.tenders SET amount_cents = 9800, application_fee_cents = 30 WHERE id = $1', [a.tenderId]);
    s.fake.balance.push(removed!);
    s.fake.balance.splice(s.fake.balance.findIndex((x) => x.id === 'txn_stray'), 1);
    await reconcileAll(db, s.fake.provider, { since: SINCE, merchant: s.merchant });
    expect(await openFlags(db, s.merchant)).toEqual([]);
  });

  test('a paid payout the books don’t have, or have differently, is flagged', async () => {
    const s = await shop();
    await s.sellCard(9800);
    const p = s.fake.payout('paid');
    await db.query(
      `INSERT INTO payments.card_payouts (id, merchant, connector_id, status, arrival_date, automatic, amount_cents, breakdown_ok) VALUES ($1,$2,$3,'paid','2026-09-28',true,$4,true)`,
      [p.id, s.merchant, s.connectorId, p.amountCents],
    );
    const flags = await findMismatches(db, s.fake.provider, { merchant: s.merchant, account: s.acct, since: SINCE });
    expect(flags.map((f) => f.kind)).toEqual(['payout_unbooked']);
  });
});

describe('Overview', () => {
  test('sales by method, tips by person, tax, discounts, refunds and top items, Clear included', async () => {
    const s = await shop();
    await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    await s.sellCard(10000, 1000);
    const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'Patch', note: null, amountCents: 1800, taxKind: 'labour' }] });
    await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 1800, tipCents: 200, handedOverCents: 2000, idempotencyKey: key() } });
    const c = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.luis, lines: [{ itemId: null, name: 'Alignment', note: null, amountCents: 9000, taxKind: 'labour' }] });
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, status, idempotency_key, request_hash, created_by, clear_charge_code) VALUES ($1,$2,$3,'clear',9000,'approved',$4,'h',$5,$6)`,
        [`tnd_ov_${c.id}`, s.merchant, c.id, key(), s.staff.luis, `CLR${seq}`],
      );
      const { settleOrder } = await import('../orders/settle.js');
      await settleOrder(tx, { merchant: s.merchant, orderId: c.id, actor: s.staff.luis });
    });
    const today = o.businessDate;
    const v = await overview(db, { merchant: s.merchant, from: today, to: today });
    expect(v).toMatchObject({
      takenCents: 11000 + 2000 + 9000,
      orderCount: 3,
      byMethod: { card: { count: 1, cents: 11000 }, cash: { count: 1, cents: 2000 }, clear: { count: 1, cents: 9000 } },
      tips: { cents: 1200, byStaff: [{ staffId: s.staff.jen, name: 'Jen', cents: 1200 }] },
      refundsCents: 0,
    });
    expect(v.topItems.map((i) => [i.name, i.cents])).toEqual([['Quick sales', 20800]]);
  });
});
