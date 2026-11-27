import { beforeAll, describe, expect, test } from 'bun:test';
import type Stripe from 'stripe';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { tipsPayable } from '../ledger/accounts.js';
import { balance, entriesFor } from '../ledger/ledgerService.js';
import { settleOrder } from '../orders/settle.js';
import { cardPaymentHandlers } from '../stripeEvents/cardPaymentHandlers.js';
import { processPending, recordEvent } from '../stripeEvents/inbox.js';
import { adjustCardTip, cancelCardTender, captureCardTender, captureDue, createCardTender, presentCardTender, refundCardTender, syncCardTender, TenderError } from './cardTenders.js';
import { connectorStore } from './connectorStore.js';
import { fakeProvider } from './fakeProvider.js';
import { connectionToken, listReaders, recordReader, registerSmartReader, TerminalError } from './terminal.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

let seq = 0;
const key = () => `idem-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

/** A shop that can take cards, with a reader, and an order for $92.75 raised by Jen. */
async function cardShop(opts: { chargesEnabled?: boolean; address?: boolean } = {}) {
  const shop = await seedShop(db);
  const fake = fakeProvider();
  const acct = `acct_${Math.random().toString(36).slice(2, 10)}`;
  const connector = await connectorStore.insert(db, { merchant: shop.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: shop.staff.owner });
  if (opts.chargesEnabled ?? true) {
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
  }
  if (opts.address ?? true) {
    await db.query(
      `UPDATE merchant.profiles SET address_line1 = '4120 Market St', address_city = 'Riverside', address_region = 'CA', address_postal_code = '92501' WHERE merchant = $1`,
      [shop.merchant],
    );
  }
  const readerId = `rdr_${seq++}_${Math.random().toString(36).slice(2, 6)}`;
  await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1, $2, $3, 'stripe', 'm2', $4, 'Counter M2')`, [
    readerId,
    shop.merchant,
    connector.id,
    `STRM2-${readerId}`,
  ]);
  const order = (figures = { subtotal: 8610, discount: 0, tax: 665 }) => newOrder(shop.merchant, shop.staff.jen, figures);
  return { ...shop, fake, acct, readerId, order };
}

async function newOrder(merchant: string, raisedBy: string, f: { subtotal: number; discount: number; tax: number }) {
  const id = `ord_${++seq}_${Math.random().toString(36).slice(2, 6)}`;
  await db.query(
    `INSERT INTO commerce.orders (id, merchant, raised_by, subtotal_cents, discount_cents, tax_cents, total_cents, business_date) VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-09-24')`,
    [id, merchant, raisedBy, f.subtotal, f.discount, f.tax, f.subtotal - f.discount + f.tax],
  );
  return id;
}

const tender = async (id: string) => (await db.query<Record<string, unknown>>('SELECT * FROM payments.tenders WHERE id = $1', [id])).rows[0]!;
const orderRow = async (id: string) => (await db.query<{ status: string; tip_cents: string | number }>('SELECT status, tip_cents FROM commerce.orders WHERE id = $1', [id])).rows[0]!;
const liveSales = async (merchant: string, orderId: string) => {
  const sales = (await entriesFor(db, merchant, { type: 'order', id: orderId })).filter((e) => e.kind.endsWith('_sale'));
  const { rows } = await db.query<{ reverses: string }>('SELECT reverses FROM ledger.journal_entries WHERE reverses = ANY($1::text[])', [sales.map((e) => e.id)]);
  return sales.filter((e) => !rows.some((r) => r.reverses === e.id));
};

async function startCard(s: Awaited<ReturnType<typeof cardShop>>, orderId: string, amountCents = 9275, tipCents = 1000) {
  const start = await createCardTender(db, s.fake.provider, { merchant: s.merchant, orderId, staffId: s.staff.jen, amountCents, tipCents, readerId: s.readerId, idempotencyKey: key() });
  const paymentId = (await tender(start.tenderId)).payment_intent_id as string;
  return { ...start, paymentId };
}

describe('starting a card payment', () => {
  test('makes a manual-capture payment on the shop’s account for amount + tip, with Clear’s fee', async () => {
    const s = await cardShop();
    const o = await s.order();
    const { tenderId, clientSecret, paymentId } = await startCard(s, o);
    const p = s.fake.payments.get(paymentId)!;
    expect(p).toMatchObject({ account: s.acct, amount: 10275, fee: 30, state: 'waiting' });
    expect(p.metadata).toEqual({ clear_merchant: s.merchant, clear_order_id: o, clear_tender_id: tenderId });
    expect(clientSecret).toBe(`${paymentId}_secret`);
    expect(await tender(tenderId)).toMatchObject({ status: 'pending', application_fee_cents: 30, tip_staff_id: s.staff.jen });
    expect((await orderRow(o)).status).toBe('paying');
  });

  test('under $10.00 there is no Clear fee', async () => {
    const s = await cardShop();
    const o = await s.order({ subtotal: 900, discount: 0, tax: 0 });
    const { paymentId } = await startCard(s, o, 900, 0);
    expect(s.fake.payments.get(paymentId)!.fee).toBe(0);
  });

  test('a retry with the same key is the same payment; the same key for something else is refused', async () => {
    const s = await cardShop();
    const o = await s.order();
    const k = key();
    const input = { merchant: s.merchant, orderId: o, staffId: s.staff.jen, amountCents: 9275, tipCents: 0, readerId: s.readerId, idempotencyKey: k };
    const a = await createCardTender(db, s.fake.provider, input);
    const b = await createCardTender(db, s.fake.provider, input);
    expect(b).toEqual(a);
    expect(s.fake.payments.size).toBe(1);
    await expect(createCardTender(db, s.fake.provider, { ...input, amountCents: 5000 })).rejects.toMatchObject({ code: 'key_reused' });
  });

  test('refuses more than is owed, a closed order, another shop’s reader, and a shop that can’t take cards', async () => {
    const s = await cardShop();
    const o = await s.order();
    const base = { merchant: s.merchant, orderId: o, staffId: s.staff.jen, tipCents: 0, readerId: s.readerId };
    await expect(createCardTender(db, s.fake.provider, { ...base, amountCents: 9276, idempotencyKey: key() })).rejects.toMatchObject({ code: 'over_remaining' });
    await expect(createCardTender(db, s.fake.provider, { ...base, amountCents: 100, readerId: 'rdr_nope', idempotencyKey: key() })).rejects.toMatchObject({ code: 'reader_unknown' });
    // A pending card for part of it counts against what's left.
    await createCardTender(db, s.fake.provider, { ...base, amountCents: 9000, idempotencyKey: key() });
    await expect(createCardTender(db, s.fake.provider, { ...base, amountCents: 300, idempotencyKey: key() })).rejects.toMatchObject({ code: 'over_remaining' });

    const locked = await cardShop({ chargesEnabled: false });
    await expect(
      createCardTender(db, locked.fake.provider, { merchant: locked.merchant, orderId: await locked.order(), staffId: locked.staff.jen, amountCents: 100, tipCents: 0, readerId: locked.readerId, idempotencyKey: key() }),
    ).rejects.toBeInstanceOf(TerminalError);
  });
});

describe('after the tap', () => {
  test('authorised: the tender, the card, the order paid, and the sale booked with the tip to the raiser', async () => {
    const s = await cardShop();
    const o = await s.order();
    const { tenderId, paymentId } = await startCard(s, o);
    s.fake.tap(paymentId, { brand: 'visa', last4: '4242' });
    const t = await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId, actor: s.staff.jen });
    expect(t).toMatchObject({ status: 'authorised', cardBrand: 'visa', cardLast4: '4242', tipCents: 1000 });
    expect(await orderRow(o)).toMatchObject({ status: 'paid' });
    expect(await liveSales(s.merchant, o)).toHaveLength(1);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(10275);
    expect(await balance(db, s.merchant, tipsPayable(s.staff.jen))).toBe(1000);
  });

  test('the app’s sync and the webhook racing each other book the sale once', async () => {
    const s = await cardShop();
    const o = await s.order();
    const { tenderId, paymentId } = await startCard(s, o);
    s.fake.tap(paymentId);
    const event = {
      id: `evt_${paymentId}`,
      object: 'event',
      type: 'payment_intent.amount_capturable_updated',
      account: s.acct,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: { object: { id: paymentId, object: 'payment_intent' } },
    } as unknown as Stripe.Event;
    await recordEvent(db, 'connect', event);
    await Promise.all([
      syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId, actor: null }),
      processPending(db, cardPaymentHandlers(() => s.fake.provider), { livemode: false }),
    ]);
    await processPending(db, cardPaymentHandlers(() => s.fake.provider), { livemode: false });
    expect((await tender(tenderId)).status).toBe('authorised');
    expect(await liveSales(s.merchant, o)).toHaveLength(1);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(10275);
  });

  test('a split sale whose card part is declined keeps the cash, voids the declined attempt, and a second card pays the rest', async () => {
    const s = await cardShop();
    const o = await s.order({ subtotal: 21000, discount: 0, tax: 1779 });
    // $200.00 cash first.
    const session = `drw_${seq++}`;
    await db.query(`INSERT INTO payments.drawer_sessions (id, merchant, business_date, opened_by, starting_cash_cents) VALUES ($1, $2, '2026-09-24', $3, 15000)`, [session, s.merchant, s.staff.jen]);
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, status, idempotency_key, request_hash, created_by, drawer_session_id, handed_over_cents, change_cents)
         VALUES ($1, $2, $3, 'cash', 20000, 'approved', $4, 'h', $5, $6, 20000, 0)`,
        [`tnd_cash_${seq++}`, s.merchant, o, key(), s.staff.jen, session],
      );
      await settleOrder(tx, { merchant: s.merchant, orderId: o, actor: s.staff.jen });
    });
    const first = await startCard(s, o, 2779, 0);
    s.fake.decline(first.paymentId);
    const declined = await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: first.tenderId, actor: s.staff.jen });
    expect(declined.status).toBe('declined');
    expect(s.fake.calls.cancels).toContain(first.paymentId);
    expect((await orderRow(o)).status).toBe('paying');
    expect(await liveSales(s.merchant, o)).toHaveLength(0);

    const second = await startCard(s, o, 2779, 0);
    s.fake.tap(second.paymentId);
    await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: second.tenderId, actor: s.staff.jen });
    expect((await orderRow(o)).status).toBe('paid');
    const [sale] = await liveSales(s.merchant, o);
    expect(sale!.kind).toBe('split_sale');
    expect(await balance(db, s.merchant, 'drawer_cash')).toBe(20000);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(2779);
  });
});

describe('void before capture', () => {
  test('counter staff can’t void a paid card; a manager can, the hold is released and the sale reversed', async () => {
    const s = await cardShop();
    const o = await s.order();
    const { tenderId, paymentId } = await startCard(s, o);
    s.fake.tap(paymentId);
    await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId, actor: null });

    await expect(cancelCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId, actor: s.staff.jen, canVoidAuthorised: false })).rejects.toMatchObject({ code: 'needs_manager' });
    const voided = await cancelCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId, actor: s.staff.manager, canVoidAuthorised: true });
    expect(voided.status).toBe('cancelled');
    expect(s.fake.payments.get(paymentId)!.state).toBe('cancelled');
    expect((await orderRow(o)).status).toBe('open');
    expect(await liveSales(s.merchant, o)).toHaveLength(0);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(0);
    expect(await balance(db, s.merchant, 'sales')).toBe(0);
    expect(await balance(db, s.merchant, tipsPayable(s.staff.jen))).toBe(0);
    // Voiding again is a no-op, not an error.
    expect((await cancelCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId, actor: s.staff.manager, canVoidAuthorised: true })).status).toBe('cancelled');
  });

  test('anyone can abandon a card nobody has tapped yet', async () => {
    const s = await cardShop();
    const o = await s.order();
    const { tenderId } = await startCard(s, o);
    expect((await cancelCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId, actor: s.staff.jen, canVoidAuthorised: false })).status).toBe('cancelled');
  });

  test('paid, voided, paid again: a fresh sale, and the books show both', async () => {
    const s = await cardShop();
    const o = await s.order();
    const a = await startCard(s, o, 9275, 0);
    s.fake.tap(a.paymentId);
    await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: a.tenderId, actor: null });
    await cancelCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: a.tenderId, actor: s.staff.manager, canVoidAuthorised: true });
    const b = await startCard(s, o, 9275, 500);
    s.fake.tap(b.paymentId);
    await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: b.tenderId, actor: null });
    expect(await liveSales(s.merchant, o)).toHaveLength(1);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(9775);
    expect(await balance(db, s.merchant, 'sales')).toBe(8610);
  });
});

describe('a tip changed before capture', () => {
  test('raising it raises the hold with Clear’s fee on the new total, and books the difference', async () => {
    const s = await cardShop();
    const o = await s.order();
    const { tenderId, paymentId } = await startCard(s, o, 9275, 1000);
    s.fake.tap(paymentId, { incremental: true });
    await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId, actor: null });

    const t = await adjustCardTip(db, s.fake.provider, { merchant: s.merchant, tenderId, tipCents: 1500, actor: s.staff.jen });
    expect(t.tipCents).toBe(1500);
    expect(s.fake.calls.raises).toEqual([{ paymentId, amountCents: 10775, applicationFeeCents: 30 }]);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(10775);
    expect(await balance(db, s.merchant, tipsPayable(s.staff.jen))).toBe(1500);
    expect(Number((await orderRow(o)).tip_cents)).toBe(1500);
  });

  test('a card that can’t be raised, or refuses, keeps the first tip', async () => {
    const s = await cardShop();
    const o = await s.order();
    const { tenderId, paymentId } = await startCard(s, o, 9275, 1000);
    s.fake.tap(paymentId, { incremental: false });
    await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId, actor: null });
    await expect(adjustCardTip(db, s.fake.provider, { merchant: s.merchant, tenderId, tipCents: 1500, actor: s.staff.jen })).rejects.toMatchObject({ code: 'tip_not_raisable' });

    const s2 = await cardShop();
    const o2 = await s2.order();
    const c2 = await startCard(s2, o2, 9275, 1000);
    s2.fake.tap(c2.paymentId, { incremental: true });
    await syncCardTender(db, s2.fake.provider, { merchant: s2.merchant, tenderId: c2.tenderId, actor: null });
    s2.fake.knobs.raiseDeclines = true;
    await expect(adjustCardTip(db, s2.fake.provider, { merchant: s2.merchant, tenderId: c2.tenderId, tipCents: 2500, actor: s2.staff.jen })).rejects.toMatchObject({ code: 'tip_declined' });
    expect(Number((await tender(c2.tenderId)).tip_cents)).toBe(1000);
    expect(await balance(db, s2.merchant, 'card_receivable')).toBe(10275);
  });

  test('lowering it asks the card nothing, and capture takes the lower amount', async () => {
    const s = await cardShop();
    const o = await s.order();
    const { tenderId, paymentId } = await startCard(s, o, 9275, 1000);
    s.fake.tap(paymentId);
    await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId, actor: null });
    await adjustCardTip(db, s.fake.provider, { merchant: s.merchant, tenderId, tipCents: 0, actor: s.staff.jen });
    expect(s.fake.calls.raises).toHaveLength(0);
    await captureCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId, actor: null });
    expect(s.fake.calls.captures).toMatchObject([{ paymentId, amountCents: 9275, applicationFeeCents: 30 }]);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(9275);
    expect(await balance(db, s.merchant, tipsPayable(s.staff.jen))).toBe(0);
  });

  test('only while authorised', async () => {
    const s = await cardShop();
    const o = await s.order();
    const { tenderId } = await startCard(s, o);
    await expect(adjustCardTip(db, s.fake.provider, { merchant: s.merchant, tenderId, tipCents: 500, actor: s.staff.jen })).rejects.toBeInstanceOf(TenderError);
  });
});

describe('capture', () => {
  test('Close the day captures the shop’s authorised cards at their final amounts, once, and posts nothing new', async () => {
    const s = await cardShop();
    const o1 = await s.order();
    const o2 = await s.order({ subtotal: 2000, discount: 0, tax: 155 });
    const a = await startCard(s, o1, 9275, 1000);
    const b = await startCard(s, o2, 2155, 0);
    s.fake.tap(a.paymentId);
    s.fake.tap(b.paymentId);
    await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: a.tenderId, actor: null });
    await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: b.tenderId, actor: null });
    const before = await balance(db, s.merchant, 'card_receivable');

    const r = await captureDue(db, s.fake.provider, { merchant: s.merchant });
    expect(r.captured.sort()).toEqual([a.tenderId, b.tenderId].sort());
    expect((await tender(a.tenderId)).status).toBe('captured');
    expect(s.fake.payments.get(a.paymentId)!.captured).toBe(10275);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(before);
    expect(await captureDue(db, s.fake.provider, { merchant: s.merchant })).toEqual({ captured: [], failed: [] });
  });

  test('the safety capture takes only holds older than its cut-off', async () => {
    const s = await cardShop();
    const old = await startCard(s, await s.order(), 9275, 0);
    const fresh = await startCard(s, await s.order(), 9275, 0);
    for (const c of [old, fresh]) {
      s.fake.tap(c.paymentId);
      await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: c.tenderId, actor: null });
    }
    await db.query(`UPDATE payments.tenders SET authorised_at = now() - interval '40 hours' WHERE id = $1`, [old.tenderId]);
    const r = await captureDue(db, s.fake.provider, { authorisedBefore: new Date(Date.now() - 36 * 3600_000) });
    expect(r.captured).toContain(old.tenderId);
    expect(r.captured).not.toContain(fresh.tenderId);
  });
});

describe('refunds', () => {
  async function captured(s: Awaited<ReturnType<typeof cardShop>>) {
    const o = await s.order();
    const c = await startCard(s, o, 9275, 1000);
    s.fake.tap(c.paymentId);
    await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: c.tenderId, actor: null });
    await captureCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: c.tenderId, actor: null });
    return { ...c, orderId: o };
  }
  const refundRow = async (merchant: string, tenderId: string, amount: number, by: string, status = 'approved') => {
    const id = `rfd_${++seq}`;
    await db.query(
      `INSERT INTO payments.refunds (id, merchant, tender_id, amount_cents, status, idempotency_key, request_hash, requested_by, approved_by) VALUES ($1, $2, $3, $4, $5, $6, 'h', $7, $7)`,
      [id, merchant, tenderId, amount, status, key(), by],
    );
    return id;
  };

  test('a partial refund goes to the card, keeps Clear’s fee by default, and books the refund with its tax', async () => {
    const s = await cardShop();
    const c = await captured(s);
    const refundId = await refundRow(s.merchant, c.tenderId, 5000, s.staff.owner);
    const r = await refundCardTender(db, s.fake.provider, { merchant: s.merchant, refundId, actor: s.staff.owner });
    expect(r.status).toBe('succeeded');
    expect(s.fake.calls.refunds).toEqual([{ paymentId: c.paymentId, amountCents: 5000, refundApplicationFee: false }]);
    expect(await tender(c.tenderId)).toMatchObject({ status: 'partly_refunded', refunded_cents: 5000 });
    expect((await orderRow(c.orderId)).status).toBe('partly_refunded');
    // $50.00 back: $3.58 of it tax (665 / 9275 of the goods and tax), the rest goods.
    expect(await balance(db, s.merchant, 'refunds')).toBe(4642);
    expect(await balance(db, s.merchant, 'tax_payable')).toBe(665 - 358);
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(10275 - 5000);
    // Repeating is harmless.
    await refundCardTender(db, s.fake.provider, { merchant: s.merchant, refundId, actor: s.staff.owner });
    expect(s.fake.calls.refunds).toHaveLength(1);
  });

  test('the shop’s terms can give Clear’s fee back', async () => {
    const s = await cardShop();
    await db.query('UPDATE merchant.profiles SET refund_application_fee = true WHERE merchant = $1', [s.merchant]);
    const c = await captured(s);
    await refundCardTender(db, s.fake.provider, { merchant: s.merchant, refundId: await refundRow(s.merchant, c.tenderId, 1000, s.staff.owner), actor: s.staff.owner });
    expect(s.fake.calls.refunds[0]!.refundApplicationFee).toBe(true);
  });

  test('a pending refund lands once, when the webhook says it succeeded', async () => {
    const s = await cardShop();
    const c = await captured(s);
    s.fake.knobs.refundState = 'pending';
    const refundId = await refundRow(s.merchant, c.tenderId, 10275, s.staff.owner);
    const r = await refundCardTender(db, s.fake.provider, { merchant: s.merchant, refundId, actor: s.staff.owner });
    expect(r.status).toBe('approved');
    const external = (await db.query<{ external_refund_id: string }>('SELECT external_refund_id FROM payments.refunds WHERE id = $1', [refundId])).rows[0]!.external_refund_id;
    const ev = (id: string) =>
      ({ id, object: 'event', type: 'refund.updated', account: s.acct, created: 1, livemode: false, data: { object: { id: external, object: 'refund', status: 'succeeded', failure_reason: null } } }) as unknown as Stripe.Event;
    await recordEvent(db, 'connect', ev(`evt_r1_${refundId}`));
    await recordEvent(db, 'connect', ev(`evt_r2_${refundId}`));
    await processPending(db, cardPaymentHandlers(() => s.fake.provider), { livemode: false });
    expect(await tender(c.tenderId)).toMatchObject({ status: 'refunded', refunded_cents: 10275 });
    expect(await balance(db, s.merchant, 'card_receivable')).toBe(0);
    expect((await orderRow(c.orderId)).status).toBe('refunded');
  });

  test('an uncaptured card is voided, not refunded; and a refund must be approved first', async () => {
    const s = await cardShop();
    const o = await s.order();
    const c = await startCard(s, o);
    s.fake.tap(c.paymentId);
    await syncCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: c.tenderId, actor: null });
    await expect(refundCardTender(db, s.fake.provider, { merchant: s.merchant, refundId: await refundRow(s.merchant, c.tenderId, 100, s.staff.owner), actor: null })).rejects.toMatchObject({
      message: 'An uncaptured card is voided, not refunded',
    });
    const d = await captured(s);
    await expect(
      refundCardTender(db, s.fake.provider, { merchant: s.merchant, refundId: await refundRow(s.merchant, d.tenderId, 100, s.staff.jen, 'requested'), actor: null }),
    ).rejects.toMatchObject({ code: 'wrong_state' });
  });
});

describe('readers and connection tokens', () => {
  test('the shop’s location is made once, from its address, and tokens are scoped to it', async () => {
    const s = await cardShop();
    const [a, b] = await Promise.all([connectionToken(db, s.fake.provider, s.merchant), connectionToken(db, s.fake.provider, s.merchant)]);
    expect(s.fake.calls.locations).toHaveLength(1);
    expect(a.secret).toBe(b.secret);
    expect(s.fake.calls.tokens.every((t) => t.account === s.acct && t.locationId === s.fake.calls.tokens[0]!.locationId)).toBe(true);
  });

  test('no address, no location: the owner is told what to add', async () => {
    const s = await cardShop({ address: false });
    await expect(connectionToken(db, s.fake.provider, s.merchant)).rejects.toMatchObject({ code: 'address_needed' });
  });

  test('a smart reader is registered on the shop’s account; an M2 is recorded, and seen again later', async () => {
    const s = await cardShop();
    const smart = await registerSmartReader(db, s.fake.provider, { merchant: s.merchant, registrationCode: 'simulated-s700', label: 'Front counter' });
    expect(smart).toMatchObject({ type: 'smart', label: 'Front counter' });
    expect(smart.locationId).toStartWith('tml_');
    await recordReader(db, { merchant: s.merchant, type: 'm2', externalReaderId: 'STRM2-000123', label: 'Bay 2 M2', deviceId: null });
    await recordReader(db, { merchant: s.merchant, type: 'm2', externalReaderId: 'STRM2-000123', label: 'Bay 2 M2', deviceId: null });
    const readers = await listReaders(db, s.merchant);
    expect(readers.filter((r) => r.externalReaderId === 'STRM2-000123')).toHaveLength(1);
    expect(readers.map((r) => r.type).sort()).toEqual(['m2', 'm2', 'smart']);
  });
});

describe('a smart reader driven from the server', () => {
  async function smartShop() {
    const s = await cardShop();
    const smart = await registerSmartReader(db, s.fake.provider, { merchant: s.merchant, registrationCode: 'simulated-wpe', label: 'Front counter' });
    const o = await s.order();
    const start = await createCardTender(db, s.fake.provider, { merchant: s.merchant, orderId: o, staffId: s.staff.jen, amountCents: 9275, tipCents: 0, readerId: smart.id, idempotencyKey: key() });
    const paymentId = (await tender(start.tenderId)).payment_intent_id as string;
    return { ...s, smart, orderId: o, tenderId: start.tenderId, paymentId };
  }
  const readerEvent = (s: { acct: string }, paymentId: string, type: string) =>
    ({
      id: `evt_rdr_${++seq}`,
      object: 'event',
      type,
      account: s.acct,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: { object: { id: 'tmr_x', object: 'terminal.reader', action: { type: 'process_payment_intent', status: type.endsWith('succeeded') ? 'succeeded' : 'failed', process_payment_intent: { payment_intent: paymentId } } } },
    }) as unknown as Stripe.Event;

  test('sends the payment to its reader, and the reader’s webhook settles the tender', async () => {
    const s = await smartShop();
    await presentCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: s.tenderId });
    expect(s.fake.calls.presented).toEqual([{ reader: s.smart.externalReaderId, paymentId: s.paymentId }]);
    s.fake.tap(s.paymentId);
    await recordEvent(db, 'connect', readerEvent(s, s.paymentId, 'terminal.reader.action_succeeded'));
    await processPending(db, cardPaymentHandlers(() => s.fake.provider), { livemode: false });
    expect((await tender(s.tenderId)).status).toBe('authorised');
    expect((await orderRow(s.orderId)).status).toBe('paid');
  });

  test('a declined card on the reader ends the tender and voids the attempt', async () => {
    const s = await smartShop();
    await presentCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: s.tenderId });
    s.fake.decline(s.paymentId);
    await recordEvent(db, 'connect', readerEvent(s, s.paymentId, 'terminal.reader.action_failed'));
    await processPending(db, cardPaymentHandlers(() => s.fake.provider), { livemode: false });
    expect((await tender(s.tenderId)).status).toBe('declined');
    expect(s.fake.payments.get(s.paymentId)!.state).toBe('cancelled');
    await expect(presentCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: s.tenderId })).rejects.toMatchObject({ code: 'wrong_state' });
  });

  test('the customer cancelling on the reader leaves it pending, to send again', async () => {
    const s = await smartShop();
    await presentCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: s.tenderId });
    await recordEvent(db, 'connect', readerEvent(s, s.paymentId, 'terminal.reader.action_failed'));
    await processPending(db, cardPaymentHandlers(() => s.fake.provider), { livemode: false });
    expect((await tender(s.tenderId)).status).toBe('pending');
    await presentCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: s.tenderId });
    expect(s.fake.calls.presented).toHaveLength(2);
  });

  test('a busy or offline reader is said plainly; an M2 tender isn’t sent from the server', async () => {
    const s = await smartShop();
    s.fake.knobs.reader = 'busy';
    await expect(presentCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: s.tenderId })).rejects.toMatchObject({ code: 'reader_busy' });
    s.fake.knobs.reader = 'offline';
    await expect(presentCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: s.tenderId })).rejects.toMatchObject({ code: 'reader_offline' });
    const m2 = await startCard(s, await s.order());
    await expect(presentCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: m2.tenderId })).rejects.toMatchObject({ code: 'not_smart_reader' });
  });

  test('voiding clears the reader first, and waits if a card is mid-authorisation', async () => {
    const s = await smartShop();
    await presentCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: s.tenderId });
    s.fake.knobs.reader = 'busy';
    await expect(cancelCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: s.tenderId, actor: s.staff.jen, canVoidAuthorised: false })).rejects.toMatchObject({ code: 'reader_busy' });
    expect((await tender(s.tenderId)).status).toBe('pending');
    s.fake.knobs.reader = 'ready';
    const v = await cancelCardTender(db, s.fake.provider, { merchant: s.merchant, tenderId: s.tenderId, actor: s.staff.jen, canVoidAuthorised: false });
    expect(v.status).toBe('cancelled');
    expect(s.fake.calls.cleared).toEqual([s.smart.externalReaderId]);
  });
});
