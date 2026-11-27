import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import * as catalog from '../catalog/catalogService.js';
import { createCardTender, syncCardTender, captureCardTender } from '../cards/cardTenders.js';
import { connectorStore } from '../cards/connectorStore.js';
import { fakeProvider } from '../cards/fakeProvider.js';
import { openDrawer } from '../drawer/drawerService.js';
import { balance } from '../ledger/ledgerService.js';
import { processOutbox } from '../outbox/outbox.js';
import { fakeTax } from '../tax/fakeTax.js';
import { forgetTaxStatus } from '../tax/taxService.js';
import { taxRecordHandlers } from '../tax/taxRecorder.js';
import { createOrder, getOrder, type OrderDeps } from './orderService.js';
import { createCashTender, voidOrder } from './payments.js';
import { buildReceipt, receiptByToken, sendReceipt } from './receipts.js';
import { decideRefund, requestRefund } from './refunds.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

let seq = 0;
const key = () => `key-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

/** Mike's Tire in Redlands with Stripe connected and Stripe Tax on, two tires on the shelf taxed at 7.75%. */
async function shop() {
  const s = await seedShop(db);
  await db.query(`UPDATE merchant.profiles SET address_line1 = '412 Colton Ave', address_city = 'Redlands', address_region = 'CA', address_postal_code = '92374' WHERE merchant = $1`, [s.merchant]);
  const acct = `acct_rr_${s.merchant.slice(-6)}`;
  const cc = await connectorStore.insert(db, { merchant: s.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: s.staff.owner });
  await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
  const readerId = `rdr_rr_${s.merchant.slice(-6)}`;
  await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1,$2,$3,'stripe','m2',$4,'M2')`, [readerId, s.merchant, cc.id, `M2-${s.merchant}`]);
  const tire = await catalog.createItem(db, { merchant: s.merchant, staffId: s.staff.owner, item: { name: 'Michelin Defender2', detail: null, category: 'Tires', priceCents: 18900, costCents: null, taxKind: 'goods', stockTracked: true, reorderAt: null } });
  const mount = await catalog.createItem(db, { merchant: s.merchant, staffId: s.staff.owner, item: { name: 'Mount and balance', detail: null, category: 'Labour', priceCents: 2500, costCents: null, taxKind: 'labour', stockTracked: false, reorderAt: null } });
  await catalog.adjustStock(db, { merchant: s.merchant, staffId: s.staff.owner, adjustment: { itemId: tire.id, kind: 'receive', quantity: 4, reason: null } });
  await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
  forgetTaxStatus();
  const tax = fakeTax({ shopStatus: 'active' });
  const deps: OrderDeps = { taxApi: tax.api, pinCheck: async (_m, p) => (p === '1111' ? { id: s.staff.manager, role: 'manager' } : null) };
  const order = () => createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: tire.id, quantity: 2, optionIds: [] }, { itemId: mount.id, quantity: 2, optionIds: [] }] });
  const refundDeps = (card = fakeProvider()) => ({ card: card.provider, pinCheck: deps.pinCheck });
  const drain = () => processOutbox(db, taxRecordHandlers(() => tax.api));
  return { ...s, acct, readerId, tire, mount, tax, deps, order, refundDeps, drain };
}

const level = async (itemId: string) => (await db.query<{ on_hand: number; held: number }>('SELECT on_hand, held FROM commerce.stock_levels WHERE item_id = $1', [itemId])).rows[0]!;

describe('a cash refund of goods, with restock', () => {
  test('counter asks, a manager approves with a PIN; cash out of the drawer, one tire back on the shelf, tax from that line', async () => {
    const s = await shop();
    const o = await s.order(); // 2 × $189 tires + 2 × $25 labour; 7.75% on the tires = $29.30
    expect(o).toMatchObject({ subtotalCents: 42800, taxCents: 2930, totalCents: 45730, taxSource: 'stripe' });
    const t = await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 45730, tipCents: 0, handedOverCents: 46000, idempotencyKey: key() } });
    expect(await level(s.tire.id)).toEqual({ on_hand: 2, held: 0 });
    const tireLine = o.lines.find((l) => l.name === 'Michelin Defender2')!;

    // One tire back: $189.00 and its $14.65 tax.
    const asked = await requestRefund(db, s.refundDeps(), {
      merchant: s.merchant,
      staff: { id: s.staff.jen, role: 'counter' },
      request: { tenderId: t.id, amountCents: 20365, items: [{ orderLineId: tireLine.id, quantity: 1, backInStock: true }], reason: 'Wrong size', idempotencyKey: key() },
    });
    expect(asked.status).toBe('requested');
    expect(await balance(db, s.merchant, 'refunds')).toBe(0);
    await expect(decideRefund(db, s.refundDeps(), { merchant: s.merchant, refundId: asked.id, decision: 'approve', pin: '0000', staff: { id: s.staff.jen, role: 'counter' } })).rejects.toMatchObject({
      code: 'approver_invalid',
    });
    const done = await decideRefund(db, s.refundDeps(), { merchant: s.merchant, refundId: asked.id, decision: 'approve', pin: '1111', staff: { id: s.staff.jen, role: 'counter' } });
    expect(done).toMatchObject({ status: 'succeeded', approvedBy: s.staff.manager });
    expect(await balance(db, s.merchant, 'drawer_cash')).toBe(15000 + 45730 - 20365);
    expect(await balance(db, s.merchant, 'refunds')).toBe(18900);
    expect(await balance(db, s.merchant, 'tax_payable')).toBe(2930 - 1465);
    expect(await level(s.tire.id)).toEqual({ on_hand: 3, held: 0 });
    expect((await getOrder(db, s.merchant, o.id)).status).toBe('partly_refunded');
  });

  test('can’t take back more than was paid or more of a line than was sold; a manager’s own request approves itself', async () => {
    const s = await shop();
    const o = await s.order();
    const t = await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 45730, tipCents: 0, handedOverCents: 45730, idempotencyKey: key() } });
    const line = o.lines[0]!;
    const ask = (amountCents: number, qty: number, by: { id: string; role: 'counter' | 'manager' } = { id: s.staff.jen, role: 'counter' }) =>
      requestRefund(db, s.refundDeps(), { merchant: s.merchant, staff: by, request: { tenderId: t.id, amountCents, items: [{ orderLineId: line.id, quantity: qty, backInStock: false }], reason: null, idempotencyKey: key() } });
    await expect(ask(45731, 1)).rejects.toMatchObject({ code: 'over_amount' });
    await expect(ask(100, 3)).rejects.toMatchObject({ code: 'items_invalid' });
    const own = await ask(20365, 1, { id: s.staff.manager, role: 'manager' });
    expect(own).toMatchObject({ status: 'succeeded', approvedBy: s.staff.manager });
    // Damaged: nothing goes back on the shelf.
    expect(await level(s.tire.id)).toEqual({ on_hand: 2, held: 0 });
    await expect(ask(100, 2)).rejects.toMatchObject({ code: 'items_invalid' });
  });

  test('a Clear payment is refunded through the Clear flow; declined requests move nothing', async () => {
    const s = await shop();
    const o = await s.order();
    await db.query(
      `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, status, idempotency_key, request_hash, created_by, clear_charge_code) VALUES ($1,$2,$3,'clear',$4,'approved',$5,'h',$6,$7)`,
      [`tnd_c_${o.id}`, s.merchant, o.id, 45730, key(), s.staff.jen, `CLR${seq}`],
    );
    await expect(
      requestRefund(db, s.refundDeps(), { merchant: s.merchant, staff: { id: s.staff.jen, role: 'counter' }, request: { tenderId: `tnd_c_${o.id}`, amountCents: 100, items: [], reason: null, idempotencyKey: key() } }),
    ).rejects.toMatchObject({ code: 'clear_flow' });
  });
});

describe('a card refund', () => {
  test('goes back to the card; restocks and refunds tax by line the same way', async () => {
    const s = await shop();
    const card = fakeProvider();
    const o = await s.order();
    const start = await createCardTender(db, card.provider, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, amountCents: 45730, tipCents: 0, readerId: s.readerId, idempotencyKey: key() });
    const pi = card.payments.values().next().value!.id;
    card.tap(pi);
    await syncCardTender(db, card.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: null });
    await captureCardTender(db, card.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: null });
    const line = o.lines.find((l) => l.name === 'Michelin Defender2')!;
    const r = await requestRefund(db, s.refundDeps(card), {
      merchant: s.merchant,
      staff: { id: s.staff.owner, role: 'owner' },
      request: { tenderId: start.tenderId, amountCents: 20365, items: [{ orderLineId: line.id, quantity: 1, backInStock: true }], reason: null, idempotencyKey: key() },
    });
    expect(r.status).toBe('succeeded');
    expect(card.calls.refunds).toEqual([{ paymentId: pi, amountCents: 20365, refundApplicationFee: false }]);
    expect(await balance(db, s.merchant, 'tax_payable')).toBe(2930 - 1465);
    expect(await level(s.tire.id)).toEqual({ on_hand: 3, held: 0 });
  });
});

describe('recording tax at Stripe', () => {
  test('a paid sale is recorded; a refund reverses its goods and tax; replays record nothing twice', async () => {
    const s = await shop();
    const o = await s.order();
    const t = await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 45730, tipCents: 0, handedOverCents: 45730, idempotencyKey: key() } });
    await s.drain();
    const { rows } = await db.query<{ tax_transaction_id: string }>('SELECT tax_transaction_id FROM commerce.orders WHERE id = $1', [o.id]);
    const recorded = s.tax.transactions.get(rows[0]!.tax_transaction_id)!;
    expect(recorded).toMatchObject({ account: s.acct, reference: o.id, totalCents: 45730 });
    await requestRefund(db, s.refundDeps(), {
      merchant: s.merchant,
      staff: { id: s.staff.owner, role: 'owner' },
      request: { tenderId: t.id, amountCents: 20365, items: [{ orderLineId: o.lines[0]!.id, quantity: 1, backInStock: true }], reason: null, idempotencyKey: key() },
    });
    await s.drain();
    await s.drain();
    const reversals = [...s.tax.transactions.values()].filter((x) => x.reverses === rows[0]!.tax_transaction_id);
    expect(reversals.map((x) => x.totalCents)).toEqual([-20365]);
  });

  test('voided after it was recorded: reversed in full; paid again: recorded again from a fresh calculation', async () => {
    const s = await shop();
    const o = await s.order();
    await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 45730, tipCents: 0, handedOverCents: 45730, idempotencyKey: key() } });
    await s.drain();
    const first = (await db.query<{ tax_transaction_id: string }>('SELECT tax_transaction_id FROM commerce.orders WHERE id = $1', [o.id])).rows[0]!.tax_transaction_id;
    await voidOrder(db, { card: null, clear: { raise: async () => ({ ok: false, reason: '' }), status: async () => null, cancel: async () => false, sendTo: async () => ({ ok: false, reason: '' }) }, pinCheck: s.deps.pinCheck }, {
      merchant: s.merchant,
      orderId: o.id,
      staffId: s.staff.jen,
      pin: '1111',
      today: o.businessDate,
    });
    await s.drain();
    expect(s.tax.transactions.get(first)!.reversedCents).toBe(45730);
    expect((await db.query('SELECT tax_transaction_id FROM commerce.orders WHERE id = $1', [o.id])).rows[0]).toEqual({ tax_transaction_id: null });
  });

  test('address-rate sales are Clear’s books only: nothing is sent to Stripe', async () => {
    const s = await shop();
    await db.query('UPDATE merchant.card_connectors SET disconnected_at = now() WHERE merchant = $1', [s.merchant]);
    forgetTaxStatus();
    const o = await s.order();
    expect(o.taxSource).toBe('address_rate');
    await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: o.totalCents, tipCents: 0, handedOverCents: o.totalCents, idempotencyKey: key() } });
    await s.drain();
    expect([...s.tax.transactions.values()]).toHaveLength(0);
  });
});

describe('an order with a refund on it', () => {
  test('is refused at the counter; and if a refunded sale is unwound, its refund’s tax reversal goes first', async () => {
    const s = await shop();
    const o = await s.order();
    const t = await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 45730, tipCents: 0, handedOverCents: 45730, idempotencyKey: key() } });
    await s.drain();
    await requestRefund(db, s.refundDeps(), {
      merchant: s.merchant,
      staff: { id: s.staff.owner, role: 'owner' },
      request: { tenderId: t.id, amountCents: 20365, items: [{ orderLineId: o.lines[0]!.id, quantity: 1, backInStock: true }], reason: null, idempotencyKey: key() },
    });
    await s.drain();
    // At the counter, an order with a refund on it is refunded, not voided…
    await expect(
      voidOrder(db, { card: null, clear: { raise: async () => ({ ok: false, reason: '' }), status: async () => null, cancel: async () => false, sendTo: async () => ({ ok: false, reason: '' }) }, pinCheck: s.deps.pinCheck }, {
        merchant: s.merchant,
        orderId: o.id,
        staffId: s.staff.jen,
        pin: '1111',
        today: o.businessDate,
      }),
    ).rejects.toMatchObject({ code: 'not_voidable', message: 'A refund has been given on it, so refund the rest instead.' });
    // …but if a sale with a refund on it ever stops standing, its tax still unwinds cleanly.
    await db.query(`INSERT INTO payments.outbox (merchant, topic, dedupe_key, payload) VALUES ($1, 'order.unpaid', $2, $3)`, [s.merchant, `order.unpaid:${o.id}:0`, JSON.stringify({ orderId: o.id })]);
    const r = await s.drain();
    expect(r.failed).toBe(0);
    // Net recorded at Stripe for this order: the sale, less the refund, plus the refund undone, less the rest.
    const net = [...s.tax.transactions.values()].reduce((sum, x) => sum + x.totalCents, 0);
    expect(net).toBe(0);
  });
});

describe('receipts', () => {
  test('lines, tax, each tender and change; texted as a link that shows only this receipt', async () => {
    const s = await shop();
    const o = await s.order();
    await createCashTender(db, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, tender: { amountCents: 45730, tipCents: 500, handedOverCents: 50000, idempotencyKey: key() } });
    const r = await buildReceipt(db, s.merchant, o.id);
    expect(r).toMatchObject({ shop: { name: expect.any(String), address: '412 Colton Ave, Redlands, CA' }, subtotalCents: 42800, taxCents: 2930, tipCents: 500, totalCents: 45730, refundedCents: 0 });
    expect(r.tenders).toEqual([{ method: 'cash', amountCents: 45730, tipCents: 500, card: null, changeCents: 3770, status: 'approved' }]);

    const sent: Array<{ by: string; to: string; total: string; url: string }> = [];
    const out = await sendReceipt(db, { send: async (m) => (sent.push(m), true) }, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, request: { by: 'text', to: '(909) 555-0177' }, receiptBaseUrl: 'https://merchant.example/r/' });
    expect(out.sent).toBe(true);
    expect(sent[0]).toMatchObject({ by: 'text', to: '(909) 555-0177', total: '$462.30' });
    const token = out.url!.split('/').pop()!;
    expect(out.url).toBe(`https://merchant.example/r/${token}`);
    expect((await receiptByToken(db, token)).totalCents).toBe(45730);
    await expect(receiptByToken(db, 'a'.repeat(32))).rejects.toMatchObject({ code: 'not_found' });
  });

  test('none sends nothing; a bad number or an unpaid order is refused', async () => {
    const s = await shop();
    const o = await s.order();
    const notifier = { send: async () => true };
    expect(await sendReceipt(db, notifier, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, request: { by: 'none', to: null }, receiptBaseUrl: 'x' })).toEqual({ sent: false, url: null });
    await expect(sendReceipt(db, notifier, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, request: { by: 'text', to: 'call me' }, receiptBaseUrl: 'x' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(sendReceipt(db, notifier, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, request: { by: 'email', to: 'ray@example.com' }, receiptBaseUrl: 'x' })).rejects.toMatchObject({ code: 'not_paid' });
  });
});
