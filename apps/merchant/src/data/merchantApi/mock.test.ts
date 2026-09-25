import { describe, expect, test } from 'bun:test';
import * as C from '@clear/merchant-contracts';
import { createMockMerchantApi } from './mock';
import { itemId, REFERENCE_DAY, STAFF_ID } from './seed';

const fast = { delayMs: 0 };
const key = (() => {
  let n = 0;
  return () => `mock-test-${++n}-key`;
})();
const range = { from: '2026-09-01', to: '2026-09-30' };

describe('the mock is the reference scenario', () => {
  test('the reference cart is $927.52, and FALL10 brings it to $834.77', async () => {
    const { api } = createMockMerchantApi(fast);
    const o = await api.createOrder({
      lines: [
        { itemId: itemId('michelin'), quantity: 4, optionIds: [] },
        { itemId: itemId('mount'), quantity: 4, optionIds: [] },
        { itemId: itemId('valves'), quantity: 1, optionIds: [] },
      ],
      customer: null,
    });
    expect(o).toMatchObject({ subtotalCents: 86800, taxCents: 5952, totalCents: 92752 });
    expect(o.lines.map((l) => l.taxCents)).toEqual([5859, 0, 93]);
    expect((await api.applyDiscount(o.id, { kind: 'code', code: 'fall10' })).totalCents).toBe(83477);
  });

  test('the day: waiting and confirmed Clear charges, the card walk-in with its tip, two cash walk-ins', async () => {
    const { api } = createMockMerchantApi(fast);
    const day = await api.orders({ date: REFERENCE_DAY });
    const by = (customer: string) => day.find((o) => o.customer === customer)!;
    expect(by('Nina P.')).toMatchObject({ totalCents: 41000, status: 'paying' });
    expect(by('Dana R.')).toMatchObject({ totalCents: 94000, status: 'paying' });
    for (const [c, cents] of [['Marcus T.', 41200], ['Priya S.', 18800], ['Ana V.', 30000]] as const) expect(by(c)).toMatchObject({ totalCents: cents, status: 'paid' });
    const card = day.find((o) => o.totalCents === 92752)!;
    expect(card).toMatchObject({ status: 'paid', tipCents: 1000 });
    expect((await api.tenders(card.id))[0]).toMatchObject({ method: 'card', status: 'authorised', cardLast4: '4242', amountCents: 92752, tipCents: 1000 });
    expect(day.filter((o) => o.customer === null && o.totalCents < 5000).map((o) => o.totalCents + o.tipCents).sort()).toEqual([2300, 3900]);
    // Goodyear: 6 on the shelf, 2 held for Nina, low, 8 on order.
    const goodyear = (await api.catalog()).find((i) => i.id === itemId('goodyear'))!;
    expect(goodyear.stock).toEqual({ onHand: 6, held: 2, free: 4 });
    expect((await api.reorders())[0]).toMatchObject({ itemId: itemId('goodyear'), quantity: 8, status: 'open' });
  });

  test('the drawer: $212 expected, both counted $208, short $4 signed off by Mike; $150 stays, $53 to the bank', async () => {
    const { api } = createMockMerchantApi({ ...fast, drawer: 'closed', viewer: STAFF_ID.mike });
    const [report] = await api.dayReports(range);
    expect(report!.drawer).toEqual({ startingCashCents: 15000, expectedCents: 21200, countedCents: 20800, differenceCents: -400, leaveCents: 15000, toBankCents: 5300, signedOffBy: STAFF_ID.mike });
    expect(report!.tipsByStaff).toEqual([
      { staffId: STAFF_ID.luis, cents: 500, how: 'cash' },
      { staffId: STAFF_ID.jen, cents: 1000, how: 'card' },
    ]);
    expect(await api.bankDeposits()).toMatchObject([{ amountCents: 5300, markedAt: null }]);
    expect((await api.cardDeposits(range))[0]).toMatchObject({ arrivalDate: '2026-09-23', netCents: 91186, processorFeeCents: 2536, clearFeeCents: 30 });
  });
});

describe('switches reach every state', () => {
  test('Stripe not connected: cards locked, and a card sale refused', async () => {
    const { api } = createMockMerchantApi({ ...fast, stripe: 'not_connected' });
    expect(await api.cardAvailability()).toEqual({ available: false, reason: 'not_connected' });
    const o = await api.createOrder({ lines: [{ itemId: null, name: 'Patch', note: null, amountCents: 3000, taxKind: 'labour' }], customer: null });
    await expect(api.createCardTender(o.id, { amountCents: 3000, tipCents: 0, readerId: 'rdr_front', idempotencyKey: key() })).rejects.toMatchObject({ status: 409 });
  });

  test('drawer: balanced, short (needs sign-off), counts disagree', async () => {
    const counts = async (drawer: 'balanced' | 'short' | 'disagree') => {
      const { api } = createMockMerchantApi({ ...fast, drawer, viewer: STAFF_ID.luis });
      return api.counts((await api.drawer())!.id);
    };
    expect(await counts('balanced')).toMatchObject({ state: 'compared', differenceCents: 0, signoffNeeded: false });
    expect(await counts('short')).toMatchObject({ state: 'compared', expectedCents: 21200, differenceCents: -400, signoffNeeded: true });
    const disagree = await counts('disagree');
    expect(disagree.state).toBe('disagree');
    expect('expectedCents' in disagree).toBe(false);
  });

  test('a declined card leaves the order owing; a Clear member answers on the second look', async () => {
    const { api, controls } = createMockMerchantApi({ ...fast, card: 'decline', clear: 'approve' });
    const o = await api.createOrder({ lines: [{ itemId: null, name: 'Brakes', note: null, amountCents: 15000, taxKind: 'labour' }], customer: null });
    const start = await api.createCardTender(o.id, { amountCents: 10000, tipCents: 0, readerId: 'rdr_front', idempotencyKey: key() });
    expect((await api.syncTender(start.tenderId)).status).toBe('declined');
    expect((await api.order(o.id)).remainingCents).toBe(15000);
    controls.set({ card: 'approve' });
    const again = await api.createCardTender(o.id, { amountCents: 10000, tipCents: 0, readerId: 'rdr_front', idempotencyKey: key() });
    expect((await api.syncTender(again.tenderId)).status).toBe('authorised');
    const clear = await api.createClearTender(o.id, { amountCents: 5000, tipCents: 0, idempotencyKey: key() });
    expect((await api.syncTender(clear.id)).status).toBe('pending');
    expect((await api.syncTender(clear.id)).status).toBe('approved');
    expect((await api.order(o.id)).status).toBe('paid');
  });

  test('a failure and a delay can be switched on', async () => {
    const { api, controls } = createMockMerchantApi({ delayMs: 30 });
    controls.failNext('catalog', 'Could not reach Clear', 503);
    await expect(api.catalog()).rejects.toMatchObject({ status: 503, message: 'Could not reach Clear' });
    const started = Date.now();
    await api.catalog();
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});

describe('the mock keeps the server’s rules', () => {
  test('counts are blind: a counter sees only their own until both are in', async () => {
    const { api, controls } = createMockMerchantApi({ ...fast, viewer: STAFF_ID.jen });
    const s = (await api.drawer())!;
    const mine = await api.saveCount(s.id, { method: 'total', totalCents: 21200 });
    expect(mine).toMatchObject({ state: 'awaiting_second', mine: { counter: STAFF_ID.jen, totalCents: 21200 } });
    controls.setViewer(STAFF_ID.luis);
    expect(await api.counts(s.id)).toEqual({ state: 'awaiting_second', mine: null });
    await expect(api.saveCount(s.id, { method: 'total', totalCents: 21200 }).then(() => api.saveCount(s.id, { method: 'total', totalCents: 1 }))).rejects.toMatchObject({ status: 409 });
  });

  test('a discount over the counter’s limit needs a manager’s PIN, and not their own', async () => {
    const { api } = createMockMerchantApi({ ...fast, viewer: STAFF_ID.jen });
    const o = await api.createOrder({ lines: [{ itemId: null, name: 'Job', note: null, amountCents: 10000, taxKind: 'labour' }], customer: null });
    const manual = (approverPin: string | null) => api.applyDiscount(o.id, { kind: 'manual', percent: 20, amountCents: null, reason: 'Regular', approverPin });
    await expect(manual(null)).rejects.toMatchObject({ status: 403 });
    await expect(manual('1111')).rejects.toMatchObject({ status: 403 });
    expect(await manual('2222')).toMatchObject({ discountCents: 2000, discount: { approvedBy: STAFF_ID.luis } });
  });

  test('void releases the hold; close captures the day’s cards', async () => {
    const { api } = createMockMerchantApi({ ...fast, drawer: 'short', viewer: STAFF_ID.luis });
    const o = await api.createOrder({ lines: [{ itemId: itemId('michelin'), quantity: 2, optionIds: [] }], customer: null });
    expect((await api.catalog()).find((i) => i.id === itemId('michelin'))!.stock!.held).toBe(2);
    await expect(api.voidOrder(o.id, { pin: '1111' })).rejects.toMatchObject({ status: 403 });
    expect((await api.voidOrder(o.id, { pin: '9999' })).status).toBe('voided');
    expect((await api.catalog()).find((i) => i.id === itemId('michelin'))!.stock!.held).toBe(0);

    const s = (await api.drawer())!;
    await expect(api.closeDay(s.id)).rejects.toMatchObject({ status: 409 });
    await api.signOff(s.id, { note: 'Change error', pin: '9999' });
    const closed = await api.closeDay(s.id);
    expect(closed.report.drawer.differenceCents).toBe(-400);
    const card = (await api.orders({ date: REFERENCE_DAY })).find((x) => x.totalCents === 92752)!;
    expect((await api.tenders(card.id))[0]!.status).toBe('captured');
  });
});

describe('every method returns the contract’s shape', () => {
  test('parsed with the contract’s own schemas', async () => {
    const { api, controls } = createMockMerchantApi({ ...fast, drawer: 'short', viewer: STAFF_ID.mike });
    const ok = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } }, v: unknown, name: string) => {
      const r = schema.safeParse(v);
      expect({ name, issues: r.success ? [] : r.error!.issues }).toEqual({ name, issues: [] });
    };
    ok(C.Shop, await api.shop(), 'shop');
    ok(C.ShopSettings, await api.settings(), 'settings');
    ok(C.Staff.array(), await api.staff(), 'staff');
    ok(C.TaxStatus, await api.taxStatus(), 'taxStatus');
    ok(C.CardAvailability, await api.cardAvailability(), 'cardAvailability');
    ok(C.ConnectionToken, await api.connectionToken(), 'connectionToken');
    ok(C.Reader.array(), await api.readers(), 'readers');
    ok(C.Reader, await api.registerSmartReader({ registrationCode: 'simulated-wpe', label: 'Back' }), 'registerSmartReader');
    ok(C.Reader, await api.recordReader({ type: 'tap_to_pay', externalReaderId: 'ttp-1', label: 'Phone' }), 'recordReader');
    ok(C.CatalogItem.array(), await api.catalog(), 'catalog');
    const item = await api.createItem({ name: 'Wiper blades', detail: null, category: 'Parts', priceCents: 2400, costCents: 900, taxKind: 'goods', stockTracked: true, reorderAt: 4 });
    ok(C.CatalogItem, item, 'createItem');
    ok(C.CatalogItem, await api.updateItem(item.id, { priceCents: 2600 }), 'updateItem');
    ok(C.CatalogItem, await api.saveOptionGroups(item.id, [{ name: 'Size', rule: 'one', required: true, position: 0, options: [{ id: 'new', name: '22"', deltaCents: 0, position: 0 }] }]), 'saveOptionGroups');
    ok(C.CatalogItem, await api.adjustStock({ itemId: item.id, kind: 'receive', quantity: 10, reason: null }), 'adjustStock');
    ok(C.CatalogItem, await api.adjustStock({ itemId: item.id, kind: 'count', found: 9, reason: 'Shelf count' }), 'adjustStock count');
    ok(C.StockMovement.array(), await api.stockHistory(item.id), 'stockHistory');
    const reo = await api.markReordered({ itemId: item.id, quantity: 6, supplier: null, expectedOn: null });
    ok(C.Reorder, reo, 'markReordered');
    ok(C.Reorder, await api.receiveReorder(reo.id, { quantity: 6 }), 'receiveReorder');
    ok(C.Reorder.array(), await api.reorders(), 'reorders');
    ok(C.DiscountCode, await api.createDiscountCode({ code: 'SPRING5', percent: null, amountCents: 500, appliesTo: { all: true }, startsAt: null, endsAt: null, oncePerCustomer: true }), 'createDiscountCode');
    ok(C.DiscountCode.array(), await api.discountCodes(), 'discountCodes');
    const o = await api.createOrder({ lines: [{ itemId: itemId('tpms'), quantity: 1, optionIds: [] }], customer: 'Lee' });
    ok(C.Order, o, 'createOrder');
    ok(C.Order, await api.updateOrder(o.id, { lines: [{ itemId: itemId('tpms'), quantity: 2, optionIds: [] }] }), 'updateOrder');
    ok(C.Order, await api.applyDiscount(o.id, { kind: 'code', code: 'FALL10' }), 'applyDiscount');
    ok(C.Order, await api.removeDiscount(o.id), 'removeDiscount');
    ok(C.Order, await api.order(o.id), 'order');
    ok(C.Order.array(), await api.orders({ date: REFERENCE_DAY }), 'orders');
    ok(C.Tender, await api.createCashTender(o.id, { amountCents: 5000, tipCents: 0, handedOverCents: 6000, idempotencyKey: key() }), 'createCashTender');
    const start = await api.createCardTender(o.id, { amountCents: (await api.order(o.id)).remainingCents, tipCents: 0, readerId: 'rdr_front', idempotencyKey: key() });
    ok(C.CardTenderStart, start, 'createCardTender');
    ok(C.Tender, await api.presentTender(start.tenderId), 'presentTender');
    ok(C.Tender, await api.syncTender(start.tenderId), 'syncTender');
    ok(C.Tender, await api.adjustTip(start.tenderId, { tipCents: 300 }), 'adjustTip');
    ok(C.Tender.array(), await api.tenders(o.id), 'tenders');
    const o2 = await api.createOrder({ lines: [{ itemId: null, name: 'x', note: null, amountCents: 1000, taxKind: 'labour' }], customer: null });
    ok(C.Tender, await api.createClearTender(o2.id, { amountCents: 1000, tipCents: 0, idempotencyKey: key() }), 'createClearTender');
    const s2 = await api.createCardTender(o2.id, { amountCents: 1000, tipCents: 0, readerId: 'rdr_front', idempotencyKey: key() }).catch(() => null);
    if (s2) ok(C.Tender, await api.cancelTender(s2.tenderId), 'cancelTender');
    ok(C.Order, await api.voidOrder(o2.id, { pin: '9999' }), 'voidOrder');
    ok(C.Receipt, await api.receipt(o.id), 'receipt');
    const walked = await api.createOrder({ lines: [{ itemId: itemId('tpms'), quantity: 1, optionIds: [] }], customer: null });
    ok(C.Order, await api.discardOrder(walked.id), 'discardOrder');
    const s = (await api.drawer())!;
    ok(C.DrawerSession, s, 'drawer');
    ok(C.CountsView, await api.counts(s.id), 'counts');
    // Luis made the first count, so the sign-off is Mike's.
    ok(C.CountsView, await api.signOff(s.id, { note: 'Change error', pin: '9999' }), 'signOff');
    const closed = await api.closeDay(s.id);
    ok(C.CloseDayResult, closed, 'closeDay');
    ok(C.BankDeposit.array(), await api.bankDeposits(), 'bankDeposits');
    ok(C.BankDeposit, await api.markDeposited((await api.bankDeposits())[0]!.id), 'markDeposited');
    const refund = await api.requestRefund({ tenderId: start.tenderId, amountCents: 500, items: [], reason: null, idempotencyKey: key() });
    ok(C.Refund, refund, 'requestRefund');
    ok(C.DayReport.array(), await api.dayReports(range), 'dayReports');
    ok(C.CardDeposit.array(), await api.cardDeposits(range), 'cardDeposits');
    ok(C.Overview, await api.overview(range), 'overview');
    ok(C.ClearFeeBill.array(), await api.clearFeeBills(), 'clearFeeBills');
    ok(C.AuditEntry.array(), await api.audit(range), 'audit');
    ok(C.CatalogItem, await api.archiveItem(item.id), 'archiveItem');
    // A shift's view, for the drawer opening on a fresh day.
    controls.setViewer(STAFF_ID.jen);
    ok(C.DrawerSession, await api.openDrawer({ startingCashCents: 15000 }), 'openDrawer');
  });
});

describe("the older client's Clear side, from the same state", () => {
  const refundInput = (chargeCode: string) => ({ chargeCode, splitInto: 4, cyclesCleared: 0, ratePerCycle: 0.02, discountRate: 0.02, nextPayoutCents: 421891 });

  test('Charges lists the reference: two waiting, four confirmed, Tom expired; payouts only for money roles', async () => {
    const { clear } = createMockMerchantApi(fast);
    const all = await clear.charges();
    expect(all.map((c) => [c.memberName, c.state, c.amount, c.splitInto])).toEqual([
      ['Dana R.', 'waiting', 940, null],
      ['Nina P.', 'waiting', 410, null],
      ['Marcus T.', 'approved', 412, 4],
      ['Priya S.', 'approved', 188, 1],
      ['Ana V.', 'approved', 300, 2],
      ['Ray C.', 'approved', 1240, 2],
      ['Tom B.', 'expired', 310, 4],
    ]);
    // 2.0% over time, 1.25% paid now: what the charge page shows the owner.
    expect(all.find((c) => c.code === 'CLR-MARCUS')!.payout).toBe(403.76);
    expect(all.find((c) => c.code === 'CLR-PRIYA')!.payout).toBe(185.65);
    const counter = createMockMerchantApi({ ...fast, viewer: STAFF_ID.jen }).clear;
    expect((await counter.charges()).every((c) => c.payout === undefined)).toBe(true);
    await expect(counter.payouts()).rejects.toThrow();
  });

  test('a charge raised in New Charge is the one Charges lists, and it can be cancelled while it waits', async () => {
    const { api, clear } = createMockMerchantApi(fast);
    const o = await api.createOrder({ lines: [{ itemId: null, name: 'Patch', note: null, amountCents: 5000, taxKind: 'labour' }], customer: 'Sam W.' });
    const t = await api.createClearTender(o.id, { amountCents: 5000, tipCents: 0, idempotencyKey: key() });
    const [newest] = await clear.charges();
    expect(newest).toMatchObject({ code: t.clearChargeCode, memberName: 'Sam W.', state: 'waiting', amount: 50 });
    await clear.cancelCharge(t.clearChargeCode!);
    expect((await clear.charges())[0].state).toBe('cancelled');
    await expect(clear.cancelCharge('CLR-MARCUS')).rejects.toThrow('Only a charge still waiting');
  });

  test('a refund: a manager PIN clears it under the limit; over it, only the owner on their own device', async () => {
    const { clear, controls } = createMockMerchantApi({ ...fast, viewer: STAFF_ID.jen });
    const r = await clear.requestRefund(refundInput('CLR-MARCUS'));
    expect(r).toMatchObject({ state: 'requested', requestedByName: 'Jen R.', amountCents: 41200 });
    expect(await clear.openRefundFor('CLR-MARCUS')).toMatchObject({ id: r.id });
    await expect(clear.checkOwnerCode('1111')).rejects.toThrow('not recognised'); // a counter PIN
    expect(await clear.checkOwnerCode('2222')).toMatchObject({ name: 'Luis M.', role: 'manager' });
    expect(await clear.authoriseRefund(r.id, '2222', 'approve')).toMatchObject({ state: 'approved', decidedVia: 'owner_code', decidedByName: 'Luis M.' });
    expect((await clear.charges()).find((c) => c.code === 'CLR-MARCUS')!.state).toBe('refunded');

    const big = await clear.requestRefund(refundInput('CLR-RAY'));
    await expect(clear.authoriseRefund(big.id, '9999', 'approve')).rejects.toThrow('Over the limit');
    await expect(clear.decideRefund(big.id, 'approve')).rejects.toThrow('Only the owner');
    controls.setViewer(STAFF_ID.mike);
    expect(await clear.decideRefund(big.id, 'approve')).toMatchObject({ state: 'approved', decidedVia: 'owner_device' });
  });

  test('the roster, the staff list and the profile', async () => {
    const owner = createMockMerchantApi(fast).clear;
    expect((await owner.roster()).map((s) => s.name)).toEqual(['Jen R.', 'Luis M.', 'Mike R.', 'Ana Ruiz']);
    expect((await owner.staff()).find((s) => s.id === STAFF_ID.jen)!.chargesThisMonth).toBe(18);
    expect(await owner.profile()).toMatchObject({ name: 'Mike’s Tire', founding: true, discountRate: 0.02, payoutAccount: 'Chase ••4417' });
    const counter = createMockMerchantApi({ ...fast, viewer: STAFF_ID.jen }).clear;
    expect(await counter.profile()).not.toHaveProperty('discountRate');
  });
});
