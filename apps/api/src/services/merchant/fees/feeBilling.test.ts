import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { applyPaymentSnapshot, captureCardTender, createCardTender, syncCardTender } from '../cards/cardTenders.js';
import { connectorStore } from '../cards/connectorStore.js';
import { fakeProvider } from '../cards/fakeProvider.js';
import { balance, ensureAccounts, post } from '../ledger/ledgerService.js';
import * as postings from '../ledger/postings.js';
import { createOrder, type OrderDeps } from '../orders/orderService.js';
import { requestRefund } from '../orders/refunds.js';
import { findMismatches } from '../payouts/reconcile.js';
import { collectBills, type FeeCollector, feeBills, previousPeriod, raiseBill, raiseBills } from './feeBilling.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

let seq = 0;
const key = () => `fb-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const deps: OrderDeps = { taxApi: null, pinCheck: async () => null };

/** A shop taking cards through a processor that can (or can't) take Clear's fee off each sale. */
async function shop(opts: { platformFee: boolean }) {
  const s = await seedShop(db);
  const fake = fakeProvider({ platformFee: opts.platformFee });
  const acct = `acct_fb_${s.merchant.slice(-6)}`;
  const cc = await connectorStore.insert(db, { merchant: s.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: s.staff.owner });
  await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
  const reader = `rdr_fb_${s.merchant.slice(-6)}`;
  await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1,$2,$3,'stripe','m2',$4,'M2')`, [reader, s.merchant, cc.id, `M2-${reader}`]);
  /** Rings up a card sale and taps it; `capture` false leaves it authorised. */
  const sellCard = async (amountCents: number, capture = true) => {
    const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'Tires', note: null, amountCents, taxKind: 'goods' }] });
    const start = await createCardTender(db, fake.provider, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, amountCents, tipCents: 0, readerId: reader, idempotencyKey: key() });
    const pi = [...fake.payments.keys()].at(-1)!;
    fake.tap(pi);
    await syncCardTender(db, fake.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: null });
    if (capture) await captureCardTender(db, fake.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: null });
    return { orderId: o.id, tenderId: start.tenderId, pi };
  };
  return { ...s, fake, sellCard };
}

const tender = async (id: string) =>
  (await db.query<{ application_fee_cents: string | number; clear_fee_billed_cents: string | number; fee_billed: boolean }>('SELECT application_fee_cents, clear_fee_billed_cents, fee_billed FROM payments.tenders WHERE id = $1', [id])).rows[0]!;

/** A collector that does what it's told: pays, comes up short, or loses track mid-send. */
function collector(mode: { value: 'ok' | 'short' | 'lost' }) {
  const calls: Array<{ billId: string; amountCents: number }> = [];
  const c: FeeCollector = {
    async collect({ billId, amountCents }) {
      calls.push({ billId, amountCents });
      if (mode.value === 'short') return { ok: false, short: true, reason: 'The cash account holds 12 cents' };
      if (mode.value === 'lost') throw new Error('The transaction was accepted but has not been included yet.');
      return { ok: true, txHash: `0x${'ab'.repeat(32)}` };
    },
  };
  return { c, calls };
}

describe('Clear’s fee on a processor that can’t take it', () => {
  test('the processor is never asked for a fee; Clear’s is accrued at capture, once', async () => {
    const s = await shop({ platformFee: false });
    const sale = await s.sellCard(9800);
    // The fake processor refuses any non-zero platform fee, so reaching here proves 0 was sent.
    expect(s.fake.calls.captures.at(-1)).toMatchObject({ applicationFeeCents: 0 });
    expect(await tender(sale.tenderId)).toMatchObject({ fee_billed: true, application_fee_cents: 0, clear_fee_billed_cents: 30 });
    expect(await balance(db, s.merchant, 'clear_fees_payable')).toBe(30);
    expect(await balance(db, s.merchant, 'card_processing_expense')).toBe(30);

    // A capture that reaches us again (a webhook after our own capture) accrues nothing more.
    await db.transaction((tx) =>
      applyPaymentSnapshot(tx, { merchant: s.merchant, tenderId: sale.tenderId, snapshot: { paymentId: sale.pi, state: 'captured', amountCents: 9800, capturableCents: 0, declineCode: null, card: null, incrementalSupported: false }, actor: null }),
    );
    expect(await balance(db, s.merchant, 'clear_fees_payable')).toBe(30);
  });

  test('a capture that only arrives by webhook still accrues the fee', async () => {
    const s = await shop({ platformFee: false });
    const sale = await s.sellCard(12000, false);
    await db.transaction((tx) =>
      applyPaymentSnapshot(tx, { merchant: s.merchant, tenderId: sale.tenderId, snapshot: { paymentId: sale.pi, state: 'captured', amountCents: 12000, capturableCents: 0, declineCode: null, card: null, incrementalSupported: false }, actor: null }),
    );
    expect(await balance(db, s.merchant, 'clear_fees_payable')).toBe(30);
  });

  test('under $10 there’s no fee, and on a processor that takes it there’s nothing to bill', async () => {
    const small = await shop({ platformFee: false });
    const a = await small.sellCard(900);
    expect(await tender(a.tenderId)).toMatchObject({ fee_billed: true, clear_fee_billed_cents: 0 });
    expect(await balance(db, small.merchant, 'clear_fees_payable')).toBe(0);

    const stripe = await shop({ platformFee: true });
    const b = await stripe.sellCard(9800);
    expect(stripe.fake.calls.captures.at(-1)).toMatchObject({ applicationFeeCents: 30 });
    expect(await tender(b.tenderId)).toMatchObject({ fee_billed: false, application_fee_cents: 30, clear_fee_billed_cents: 0 });
    expect(await balance(db, stripe.merchant, 'clear_fees_payable')).toBe(0);
    expect((await raiseBills(db, { merchant: stripe.merchant })).raised).toEqual([]);
  });

  test('a refund gives the fee back in proportion when the shop’s setting says so, and keeps it when not', async () => {
    const s = await shop({ platformFee: false });
    await db.query('UPDATE merchant.profiles SET refund_application_fee = true WHERE merchant = $1', [s.merchant]);
    const a = await s.sellCard(10000);
    const r = await requestRefund(db, { card: s.fake.provider, pinCheck: deps.pinCheck }, {
      merchant: s.merchant,
      staff: { id: s.staff.owner, role: 'owner' },
      request: { tenderId: a.tenderId, amountCents: 5000, items: [], reason: null, idempotencyKey: key() },
    });
    expect(r.status).toBe('succeeded');
    expect(await balance(db, s.merchant, 'clear_fees_payable')).toBe(15);

    await db.query('UPDATE merchant.profiles SET refund_application_fee = false WHERE merchant = $1', [s.merchant]);
    await requestRefund(db, { card: s.fake.provider, pinCheck: deps.pinCheck }, {
      merchant: s.merchant,
      staff: { id: s.staff.owner, role: 'owner' },
      request: { tenderId: a.tenderId, amountCents: 5000, items: [], reason: null, idempotencyKey: key() },
    });
    expect(await balance(db, s.merchant, 'clear_fees_payable')).toBe(15);
  });
});

describe('the monthly bill', () => {
  /** Accrues a fee at a moment, as a capture then would have. */
  const accrue = async (merchant: string, feeCents: number, at: string) => {
    await db.transaction(async (tx) => {
      await ensureAccounts(tx, merchant, ['clear_fees_payable', 'card_processing_expense']);
      await post(tx, postings.clearFeeAccrued({ merchant, tenderId: `tnd_${key()}`, feeCents, occurredAt: at })!);
    });
  };

  test('is for what was owed at the end of the month in the shop’s own time zone; one per month', async () => {
    const s = await seedShop(db); // America/Los_Angeles
    await accrue(s.merchant, 30, '2026-09-10T18:00:00Z');
    await accrue(s.merchant, 30, '2026-10-01T05:00:00Z'); // 10pm on 30 September in Los Angeles
    await accrue(s.merchant, 30, '2026-10-01T08:00:00Z'); // 1am on 1 October there: October's
    const sept = await db.transaction((tx) => raiseBill(tx, { merchant: s.merchant, period: '2026-09' }));
    expect(sept).toMatchObject({ created: true, bill: { period: '2026-09', amountCents: 60, status: 'due' } });
    expect(await db.transaction((tx) => raiseBill(tx, { merchant: s.merchant, period: '2026-09' }))).toMatchObject({ created: false, bill: { id: sept.bill!.id } });

    // October's bill is October's alone, while September's is still open.
    const oct = await db.transaction((tx) => raiseBill(tx, { merchant: s.merchant, period: '2026-10' }));
    expect(oct.bill).toMatchObject({ amountCents: 30 });
  });

  test('a month that nets to nothing raises none', async () => {
    const s = await seedShop(db);
    await accrue(s.merchant, 30, '2026-08-03T18:00:00Z');
    await db.transaction((tx) => post(tx, postings.clearFeeReturned({ merchant: s.merchant, refundId: `rfd_${key()}`, feeCents: 30, occurredAt: '2026-08-04T18:00:00Z' })!));
    expect(await db.transaction((tx) => raiseBill(tx, { merchant: s.merchant, period: '2026-08' }))).toEqual({ bill: null, created: false });
  });

  test('last month is the shop’s last month', () => {
    expect(previousPeriod('America/Los_Angeles', new Date('2026-10-01T05:00:00Z'))).toBe('2026-08');
    expect(previousPeriod('America/Los_Angeles', new Date('2026-10-01T08:00:00Z'))).toBe('2026-09');
    expect(previousPeriod('UTC', new Date('2026-01-15T00:00:00Z'))).toBe('2025-12');
  });

  test('is collected from the cash account and booked; short is tried again; a lost send waits for a person', async () => {
    const s = await seedShop(db);
    await accrue(s.merchant, 90, '2026-07-10T18:00:00Z');
    const { bill } = await db.transaction((tx) => raiseBill(tx, { merchant: s.merchant, period: '2026-07' }));
    const mode = { value: 'short' as 'ok' | 'short' | 'lost' };
    const col = collector(mode);

    expect(await collectBills(db, col.c, { merchant: s.merchant })).toMatchObject({ short: [bill!.id] });
    expect((await feeBills(db, s.merchant))[0]).toMatchObject({ status: 'short', attempts: 1, lastError: 'The cash account holds 12 cents' });

    mode.value = 'ok';
    expect(await collectBills(db, col.c, { merchant: s.merchant })).toMatchObject({ collected: [bill!.id] });
    expect((await feeBills(db, s.merchant))[0]).toMatchObject({ status: 'collected', attempts: 2, txHash: `0x${'ab'.repeat(32)}` });
    expect(await balance(db, s.merchant, 'clear_fees_payable')).toBe(0);
    expect(await balance(db, s.merchant, 'cash_account')).toBe(-90);
    // Collected once however often it runs.
    await collectBills(db, col.c, { merchant: s.merchant });
    expect(col.calls).toHaveLength(2);

    // Next month's send is lost: never sent again on its own, and flagged after an hour.
    await accrue(s.merchant, 60, '2026-08-10T18:00:00Z');
    const aug = await db.transaction((tx) => raiseBill(tx, { merchant: s.merchant, period: '2026-08' }));
    // July's bill was collected after August ended (today): August's is still August's alone.
    expect(aug.bill).toMatchObject({ amountCents: 60 });
    mode.value = 'lost';
    expect(await collectBills(db, col.c, { merchant: s.merchant })).toMatchObject({ unconfirmed: [aug.bill!.id] });
    await collectBills(db, col.c, { merchant: s.merchant });
    expect(col.calls).toHaveLength(3);
    expect((await feeBills(db, s.merchant))[0]).toMatchObject({ status: 'collecting', lastError: 'The transaction was accepted but has not been included yet.' });

    const quiet = fakeProvider();
    expect(await findMismatches(db, quiet.provider, { merchant: s.merchant, account: 'acct_none', since: new Date(0) })).toEqual([]);
    await db.query(`UPDATE payments.clear_fee_bills SET attempted_at = now() - interval '2 hours' WHERE id = $1`, [aug.bill!.id]);
    expect(await findMismatches(db, quiet.provider, { merchant: s.merchant, account: 'acct_none', since: new Date(0) })).toMatchObject([{ kind: 'fee_bill_unconfirmed', ref: aug.bill!.id, expectedCents: 60 }]);
  });

  test('raiseBills finds every shop owing and bills each for its own last month', async () => {
    const s = await seedShop(db);
    await accrue(s.merchant, 45, '2026-05-20T18:00:00Z');
    const r = await raiseBills(db, { merchant: s.merchant, now: new Date('2026-06-15T18:00:00Z') });
    expect(r.raised).toMatchObject([{ merchant: s.merchant, period: '2026-05', amountCents: 45 }]);
    expect((await raiseBills(db, { merchant: s.merchant, now: new Date('2026-06-15T18:00:00Z') })).raised).toEqual([]);
  });
});
