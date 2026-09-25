import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { chargeItemFrom, codeCheck, legsFromTenders, nothingTaken, pickedOptionIds, toLineInputs, totalsFromOrder } from './live';

describe('New charge against the API', () => {
  test('the reference cart becomes the order’s lines, and the server’s order its checkout totals', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0 });
    const lines = toLineInputs(
      [
        { key: 'm', itemId: 'itm_michelin', name: 'Michelin Defender2', qty: 4, unitCents: 18900, tax: 'goods', optionIds: [] },
        { key: 'b', itemId: 'itm_mount', name: 'Mount and balance', qty: 4, unitCents: 2500, tax: 'labour' },
        { key: 'v', itemId: 'itm_valves', name: 'Valve stems, set of 4', qty: 1, unitCents: 1200, tax: 'goods' },
        { key: 'q', name: 'Patch, rear left', qty: 1, unitCents: 1800, tax: 'labour' },
      ],
      0,
    );
    expect(lines[3]).toEqual({ itemId: null, name: 'Patch, rear left', note: null, amountCents: 1800, taxKind: 'labour' });
    const o = await api.createOrder({ lines, customer: null });
    expect(totalsFromOrder(o)).toEqual({ count: 10, goodsCents: 76800, labourCents: 11800, foodCents: 0, exemptCents: 0, discountCents: 0, taxCents: 5952, totalCents: 94552 });
    // A typed amount is one untaxed line: the amount is what's charged.
    expect(toLineInputs([], 5000)).toEqual([{ itemId: null, name: 'Amount', note: null, amountCents: 5000, taxKind: 'exempt' }]);
  });

  test('codes: valid, unknown, ended', () => {
    const codes = [
      { id: 'd1', code: 'FALL10', percent: 10, amountCents: null, appliesTo: { all: true } as const, startsAt: null, endsAt: '2026-10-31T23:59:00Z', oncePerCustomer: true, uses: 0 },
      { id: 'd2', code: 'SUMMER25', percent: 25, amountCents: null, appliesTo: { all: true } as const, startsAt: null, endsAt: '2026-09-01T00:00:00Z', oncePerCustomer: false, uses: 0 },
    ];
    const now = new Date('2026-09-22T12:00:00Z');
    expect(codeCheck(codes, 'fall10', now)).toMatchObject({ code: 'FALL10', ok: true, percent: 10 });
    expect(codeCheck(codes, 'fall10', now)!.says).toContain('10% off the whole charge, before tax.');
    expect(codeCheck(codes, 'SUMMER25', now)).toMatchObject({ ok: false });
    expect(codeCheck(codes, 'NOPE', now)).toMatchObject({ ok: false, says: expect.stringContaining('isn’t one of this shop’s codes') });
    expect(codeCheck(codes, 'N', now)).toBeNull();
  });

  test('options by id, a None choice being no option; the split’s parts from the tenders', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0 });
    const michelin = chargeItemFrom((await api.catalog()).find((c) => c.id === 'itm_michelin')!);
    const [warranty, extras] = michelin.options!;
    const none = warranty!.choices.find((c) => c.name === 'None')!;
    const disposal = extras!.choices.find((c) => /disposal/i.test(c.name))!;
    expect(pickedOptionIds(michelin, { [warranty!.id]: [none.id], [extras!.id]: [disposal.id] })).toEqual([disposal.id]);

    const at = '2026-09-22T23:38:00Z';
    const base = { orderId: 'o', tipCents: 0, refundedCents: 0, readerId: null, clearChargeCode: null, handedOverCents: null, changeCents: null, createdAt: at, cardBrand: null, cardLast4: null };
    const legs = legsFromTenders([
      { ...base, id: 't1', method: 'cash', amountCents: 20000, status: 'approved', changeCents: 0 },
      { ...base, id: 't2', method: 'card', amountCents: 72752, status: 'declined', cardBrand: 'visa', cardLast4: '4242' },
      { ...base, id: 't3', method: 'clear', amountCents: 1000, status: 'cancelled' },
    ]);
    expect(legs.map((l) => [l.method, l.amountCents, l.state])).toEqual([
      ['cash', 20000, 'paid'],
      ['card', 72752, 'declined'],
    ]);
    expect(legs[1]!.det).toBe('Visa ending 4242 · the bank declined it');
    expect(nothingTaken([{ ...base, id: 'x', method: 'card', amountCents: 1, status: 'declined' }])).toBe(true);
    expect(nothingTaken([{ ...base, id: 'y', method: 'cash', amountCents: 1, status: 'approved' }])).toBe(false);
  });
});
