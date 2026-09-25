import { beforeAll, describe, expect, test } from 'bun:test';
import Stripe from 'stripe';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import * as catalog from '../catalog/catalogService.js';
import { adjustCardTip, captureCardTender, createCardTender, syncCardTender } from '../cards/cardTenders.js';
import { availabilityFor } from '../cards/cardsService.js';
import { connectorStore } from '../cards/connectorStore.js';
import { fakeProvider } from '../cards/fakeProvider.js';
import { closeDay, saveCount, signOff } from '../drawer/closeService.js';
import { openDrawer } from '../drawer/drawerService.js';
import { balance } from '../ledger/ledgerService.js';
import { createOrder, getOrder, type OrderDeps } from '../orders/orderService.js';
import { createCashTender, voidOrder } from '../orders/payments.js';
import { requestRefund } from '../orders/refunds.js';
import { openFlags, reconcileAll } from '../payouts/reconcile.js';
import { auditTrail } from '../security/audit.js';
import { cardConnectorHandlers } from '../stripeEvents/cardConnectorHandlers.js';
import { cardPaymentHandlers } from '../stripeEvents/cardPaymentHandlers.js';
import { processPending } from '../stripeEvents/inbox.js';
import { receiveStripeWebhook } from '../stripeEvents/webhook.js';
import { fakeTax } from '../tax/fakeTax.js';

/*
 * End to end with a simulated reader (card-processing prompt, Phase 10): each scenario the prompt
 * names, as one story through the real services, the ledger, stock, the webhook inbox and the audit
 * log. The fake processor plays both the customer at the reader (tap, decline) and Stripe.
 *
 * The same stories run against Stripe's own simulated reader, over HTTP, in e2e/live.ts.
 */

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

let seq = 0;
const key = () => `e2e-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const WEBHOOK_SECRET = 'whsec_e2e_connect';
const STARTING_CASH = 15000;

/** Mike's Tire, open for the day: Stripe connected, a smart reader, tires in stock, a drawer open. */
async function openShop() {
  const s = await seedShop(db);
  await db.query(`UPDATE merchant.profiles SET address_line1 = '412 Colton Ave', address_city = 'Redlands', address_region = 'CA', address_postal_code = '92374' WHERE merchant = $1`, [s.merchant]);
  const fake = fakeProvider();
  const acct = `acct_e2e_${s.merchant.slice(-6)}`;
  const cc = await connectorStore.insert(db, { merchant: s.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: s.staff.owner });
  await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
  const reader = `rdr_e2e_${s.merchant.slice(-6)}`;
  await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1,$2,$3,'stripe','smart',$4,'Front counter')`, [reader, s.merchant, cc.id, `tmr_${reader}`]);
  const tire = await catalog.createItem(db, { merchant: s.merchant, staffId: s.staff.owner, item: { name: 'Michelin Defender2', detail: null, category: 'Tires', priceCents: 18900, costCents: 13200, taxKind: 'goods', stockTracked: true, reorderAt: 2 } });
  await catalog.adjustStock(db, { merchant: s.merchant, staffId: s.staff.owner, adjustment: { itemId: tire.id, kind: 'receive', quantity: 8, reason: null } });
  const drawer = await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen, startingCashCents: STARTING_CASH });

  const managerPin = async (_m: string, pin: string) => (pin === '4321' ? { id: s.staff.manager, role: 'manager' as const } : null);
  const deps: OrderDeps = { taxApi: fakeTax().api, pinCheck: managerPin };
  const order = (lines: Parameters<typeof createOrder>[2]['lines']) => createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines });
  /** The customer at the reader: taps (or is declined), and the app asks where it stands. */
  const card = async (orderId: string, amountCents: number, opts: { tipCents?: number; decline?: boolean } = {}) => {
    const start = await createCardTender(db, fake.provider, { merchant: s.merchant, orderId, staffId: s.staff.jen, amountCents, tipCents: opts.tipCents ?? 0, readerId: reader, idempotencyKey: key() });
    const pi = [...fake.payments.keys()].at(-1)!;
    if (opts.decline) fake.decline(pi, 'card_declined');
    else fake.tap(pi, { incremental: true });
    return syncCardTender(db, fake.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: s.staff.jen });
  };
  const level = async () => (await db.query<{ on_hand: number; held: number }>('SELECT on_hand, held FROM commerce.stock_levels WHERE item_id = $1', [tire.id])).rows[0]!;
  /** Two blind counts, both at `countedCents`; a difference needs the manager's sign-off first. */
  const countAndClose = async (countedCents: number) => {
    for (const staffId of [s.staff.jen, s.staff.luis]) await saveCount(db, { merchant: s.merchant, sessionId: drawer.id, staffId, count: { method: 'total', totalCents: countedCents } });
    return closeDay(db, { card: fake.provider }, { merchant: s.merchant, sessionId: drawer.id, staffId: s.staff.luis });
  };
  const trail = async () => auditTrail(db, { merchant: s.merchant, from: '2000-01-01', to: '2100-01-01' });
  return { ...s, fake, acct, reader, tire, drawer, deps, managerPin, order, card, level, countAndClose, trail };
}

describe('end to end, with a simulated reader', () => {
  test('a split sale whose card part is declined: the cash stays paid, the order still owes the rest', async () => {
    const s = await openShop();
    const o = await s.order([{ itemId: s.tire.id, quantity: 1, optionIds: [] }]); // $189 + 7.75% = $203.65
    expect(o.totalCents).toBe(20365);
    await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 5000, tipCents: 0, handedOverCents: 5000, idempotencyKey: key() } });

    const declined = await s.card(o.id, 15365, { decline: true });
    expect(declined.status).toBe('declined');
    const after = await getOrder(db, s.merchant, o.id);
    expect(after).toMatchObject({ status: 'paying', remainingCents: 15365 });
    // Nothing booked yet (the order isn't paid), and the tire is still held for it, not sold.
    expect(await balance(db, s.merchant, 'sales')).toBe(0);
    expect(await s.level()).toEqual({ on_hand: 8, held: 1 });

    // Another card, and it goes through.
    const ok = await s.card(o.id, 15365);
    expect(ok.status).toBe('authorised');
    expect(await getOrder(db, s.merchant, o.id)).toMatchObject({ status: 'paid', remainingCents: 0 });
    expect(await s.level()).toEqual({ on_hand: 7, held: 0 });
    expect(await balance(db, s.merchant, 'drawer_cash')).toBe(STARTING_CASH + 5000);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(15365);
    expect((await s.trail()).filter((e) => e.action === 'card.declined')).toHaveLength(1);
  });

  test('void before close: the hold is released, the sale undone, the tire back on the shelf', async () => {
    const s = await openShop();
    const o = await s.order([{ itemId: s.tire.id, quantity: 2, optionIds: [] }]);
    const t = await s.card(o.id, o.totalCents);
    expect(await s.level()).toEqual({ on_hand: 6, held: 0 });

    // A counter can't void alone; the manager's PIN can.
    await expect(voidOrder(db, { card: s.fake.provider, clear: null as never, pinCheck: s.managerPin }, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, pin: '0000', today: o.businessDate })).rejects.toMatchObject({ code: 'approver_invalid' });
    const voided = await voidOrder(db, { card: s.fake.provider, clear: null as never, pinCheck: s.managerPin }, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, pin: '4321', today: o.businessDate });
    expect(voided.status).toBe('voided');
    expect(s.fake.calls.cancels).toContain([...s.fake.payments.keys()].at(-1)!);
    expect(await s.level()).toEqual({ on_hand: 8, held: 0 });
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(0);
    expect(await balance(db, s.merchant, 'sales')).toBe(0);

    // Close: nothing to capture, and the day shows no sale.
    const closed = await s.countAndClose(STARTING_CASH);
    expect(s.fake.calls.captures).toEqual([]);
    expect(closed.captureFailures).toEqual([]);
    expect((await s.trail()).find((e) => e.action === 'order.voided')).toMatchObject({ actor: s.staff.jen, approver: s.staff.manager, ref: { id: o.id } });
    expect(t.status).toBe('authorised');
  });

  test('a tip added after the tap, before close: the hold is raised and the tip captured with the sale', async () => {
    const s = await openShop();
    const o = await s.order([{ itemId: null, name: 'Mount and balance', note: null, amountCents: 10000, taxKind: 'labour' }]);
    const t = await s.card(o.id, 10000);
    const tipped = await adjustCardTip(db, s.fake.provider, { merchant: s.merchant, tenderId: t.id, tipCents: 1500, actor: s.staff.jen });
    expect(tipped.tipCents).toBe(1500);
    expect(s.fake.calls.raises.at(-1)).toMatchObject({ amountCents: 11500, applicationFeeCents: 30 });

    const closed = await s.countAndClose(STARTING_CASH);
    expect(closed.captureFailures).toEqual([]);
    // Captured at close for sale and tip, with Clear's 30¢ on the total.
    expect(s.fake.calls.captures).toMatchObject([{ amountCents: 11500, applicationFeeCents: 30 }]);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(11500);
    expect(closed.report.tipsCents).toBe(1500);
    expect(closed.report.tipsByStaff).toEqual([{ staffId: s.staff.jen, cents: 1500, how: 'card' }]);
  });

  test('a partial refund of goods with restock: one tire back on the shelf, its tax back, the card refunded', async () => {
    const s = await openShop();
    const o = await s.order([{ itemId: s.tire.id, quantity: 2, optionIds: [] }]); // 2 × $189 + tax = $407.30
    const t = await s.card(o.id, o.totalCents);
    await captureCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: t.id, actor: s.staff.luis });
    expect(await s.level()).toEqual({ on_hand: 6, held: 0 });

    const line = o.lines[0]!;
    const refund = await requestRefund(db, { card: s.fake.provider, pinCheck: s.managerPin }, {
      merchant: s.merchant,
      staff: { id: s.staff.manager, role: 'manager' },
      request: { tenderId: t.id, amountCents: 20365, items: [{ orderLineId: line.id, quantity: 1, backInStock: true }], reason: 'Wrong size', idempotencyKey: key() },
    });
    expect(refund.status).toBe('succeeded');
    expect(s.fake.calls.refunds.at(-1)).toMatchObject({ amountCents: 20365 });
    expect(await s.level()).toEqual({ on_hand: 7, held: 0 });
    // Tax back for that one tire ($14.65), not a flat share of the order's.
    expect(await balance(db, s.merchant, 'tax_payable')).toBe(o.taxCents - 1465);
    expect(await balance(db, s.merchant, 'refunds')).toBe(18900);
    expect(await getOrder(db, s.merchant, o.id)).toMatchObject({ status: 'partly_refunded' });
  });

  test('a short drawer: blind counts agree $5 short, close waits for a manager’s sign-off, then locks the day', async () => {
    const s = await openShop();
    const o = await s.order([{ itemId: null, name: 'Patch', note: null, amountCents: 3000, taxKind: 'labour' }]);
    await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 3000, tipCents: 0, handedOverCents: 3000, idempotencyKey: key() } });

    await expect(s.countAndClose(STARTING_CASH + 3000 - 500)).rejects.toMatchObject({ code: 'unsigned' });
    // The first counter can't sign off their own count; the manager can.
    await signOff(db, { pinCheck: s.managerPin }, { merchant: s.merchant, sessionId: s.drawer.id, staffId: s.staff.luis, signOff: { note: 'Gave $5 too much change', pin: '4321' } });
    const closed = await closeDay(db, { card: s.fake.provider }, { merchant: s.merchant, sessionId: s.drawer.id, staffId: s.staff.luis });
    expect(closed.report.drawer).toMatchObject({ expectedCents: STARTING_CASH + 3000, countedCents: STARTING_CASH + 2500, differenceCents: -500, signedOffBy: s.staff.manager });
    expect(await balance(db, s.merchant, 'cash_over_short')).toBe(500);
    // The day is locked: closing again returns the same report, and the drawer takes no more cash.
    expect((await closeDay(db, { card: s.fake.provider }, { merchant: s.merchant, sessionId: s.drawer.id, staffId: s.staff.owner })).report.id).toBe(closed.report.id);
    const late = await s.order([{ itemId: null, name: 'Late', note: null, amountCents: 1000, taxKind: 'labour' }]);
    await expect(createCashTender(db, { merchant: s.merchant, orderId: late.id, staffId: s.staff.jen, tender: { amountCents: 1000, tipCents: 0, handedOverCents: 1000, idempotencyKey: key() } })).rejects.toMatchObject({ code: 'drawer_closed' });
  });

  test('the merchant disconnects Stripe mid-day: cards lock, cash goes on, the stranded card is named at close and flagged', async () => {
    const s = await openShop();
    const o = await s.order([{ itemId: null, name: 'Alignment', note: null, amountCents: 9000, taxKind: 'labour' }]);
    const t = await s.card(o.id, 9000);

    // Stripe tells us, signed, through the real webhook endpoint and inbox.
    const payload = JSON.stringify({
      id: `evt_deauth_${seq}`,
      object: 'event',
      type: 'account.application.deauthorized',
      account: s.acct,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: { object: { id: 'ca_clear', object: 'application' } },
    });
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: WEBHOOK_SECRET });
    expect((await receiveStripeWebhook({ db, endpoint: 'connect', secret: WEBHOOK_SECRET, rawBody: Buffer.from(payload), signature })).status).toBe(200);
    await processPending(db, { ...cardConnectorHandlers, ...cardPaymentHandlers(() => s.fake.provider) }, { livemode: false });

    expect(await availabilityFor(db, s.fake.provider, s.merchant)).toEqual({ available: false, reason: 'disconnected' });
    const next = await s.order([{ itemId: null, name: 'Rotation', note: null, amountCents: 4000, taxKind: 'labour' }]);
    await expect(s.card(next.id, 4000)).rejects.toMatchObject({ code: 'cards_unavailable' });
    await createCashTender(db, { merchant: s.merchant, orderId: next.id, staffId: s.staff.jen, tender: { amountCents: 4000, tipCents: 0, handedOverCents: 4000, idempotencyKey: key() } });

    // Close goes ahead. The card authorised before the disconnect can't be captured by Clear any
    // more: it isn't sent to Stripe, and the close names it and says what to do.
    const closed = await s.countAndClose(STARTING_CASH + 4000);
    expect(s.fake.calls.captures).toEqual([]);
    expect(closed.captureFailures).toMatchObject([{ tenderId: t.id }]);
    expect(closed.captureFailures[0]!.error).toContain('Stripe Dashboard');

    // And the nightly reconciliation keeps it in front of a person until it's settled.
    await reconcileAll(db, s.fake.provider, { since: new Date(Date.now() - 86_400_000), merchant: s.merchant });
    expect(await openFlags(db, s.merchant)).toMatchObject([{ kind: 'card_stranded', ref: t.id, expectedCents: 9000 }]);
  });
});
