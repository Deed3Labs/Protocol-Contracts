import { describe, expect, test } from 'bun:test';
import {
  canVoidOrder,
  Cents,
  clearCardFee,
  CountsView,
  DiscountCode,
  orderStatus,
  tenderTransition,
  type TenderState,
} from './index';

describe('clearCardFee', () => {
  test('nothing under $10.00', () => {
    expect(clearCardFee(0, { kind: 'payg' })).toBe(0);
    expect(clearCardFee(999, { kind: 'payg' })).toBe(0);
    expect(clearCardFee(999, { kind: 'paid', feeCents: 20 })).toBe(0);
  });
  test('30¢ on pay-as-you-go from $10.00', () => {
    expect(clearCardFee(1000, { kind: 'payg' })).toBe(30);
    expect(clearCardFee(93752, { kind: 'payg' })).toBe(30);
  });
  test("the shop's plan fee on a paid plan", () => {
    expect(clearCardFee(1000, { kind: 'paid', feeCents: 20 })).toBe(20);
    expect(clearCardFee(50000, { kind: 'paid', feeCents: 25 })).toBe(25);
  });
  test('whole cents only', () => {
    expect(() => clearCardFee(10.5, { kind: 'payg' })).toThrow();
    expect(() => clearCardFee(-1, { kind: 'payg' })).toThrow();
  });
});

const card = (patch: Partial<TenderState> = {}): TenderState => ({ method: 'card', status: 'pending', amountCents: 2779, tipCents: 0, refundedCents: 0, ...patch });
const cash = (patch: Partial<TenderState> = {}): TenderState => ({ method: 'cash', status: 'pending', amountCents: 20000, tipCents: 0, refundedCents: 0, ...patch });
const must = <S>(r: { ok: true; state: S } | { ok: false; reason: string }): S => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

describe('a split sale whose card part is declined', () => {
  test('the cash part stays paid, and the order shows what is left', () => {
    const cashPart = must(tenderTransition(cash(), { type: 'approve' }));
    const cardPart = must(tenderTransition(card(), { type: 'decline' }));
    const summary = orderStatus({ totalCents: 22779, voided: false }, [cashPart, cardPart]);
    expect(cashPart.status).toBe('approved');
    expect(cardPart.status).toBe('declined');
    expect(summary).toMatchObject({ status: 'paying', paidCents: 20000, remainingCents: 2779 });
  });
  test('another card for the rest pays the order', () => {
    const cashPart = must(tenderTransition(cash(), { type: 'approve' }));
    const declined = must(tenderTransition(card(), { type: 'decline' }));
    const second = must(tenderTransition(card(), { type: 'authorise' }));
    expect(orderStatus({ totalCents: 22779, voided: false }, [cashPart, declined, second]).status).toBe('paid');
  });
});

describe('voiding an authorised card', () => {
  test('cancels it before capture, and the order has nothing taken', () => {
    const authorised = must(tenderTransition(card({ amountCents: 93752 }), { type: 'authorise' }));
    expect(canVoidOrder({ totalCents: 93752, voided: false }, [authorised])).toEqual({ ok: true });
    const voided = must(tenderTransition(authorised, { type: 'cancel' }));
    expect(voided.status).toBe('cancelled');
    expect(orderStatus({ totalCents: 93752, voided: true }, [voided])).toMatchObject({ status: 'voided', paidCents: 0 });
  });
  test('after capture only a refund remains', () => {
    const captured = must(tenderTransition(must(tenderTransition(card(), { type: 'authorise' })), { type: 'capture' }));
    expect(tenderTransition(captured, { type: 'cancel' }).ok).toBe(false);
    expect(canVoidOrder({ totalCents: 2779, voided: false }, [captured]).ok).toBe(false);
  });
  test('a tip changes only while authorised', () => {
    const authorised = must(tenderTransition(card({ amountCents: 92752, tipCents: 1000 }), { type: 'authorise' }));
    expect(must(tenderTransition(authorised, { type: 'adjust_tip', tipCents: 1500 })).tipCents).toBe(1500);
    const captured = must(tenderTransition(authorised, { type: 'capture' }));
    expect(tenderTransition(captured, { type: 'adjust_tip', tipCents: 2000 }).ok).toBe(false);
  });
});

describe('a partial refund', () => {
  test('of a captured card leaves it partly refunded, then refunded', () => {
    const captured = must(tenderTransition(must(tenderTransition(card({ amountCents: 22779 }), { type: 'authorise' })), { type: 'capture' }));
    const part = must(tenderTransition(captured, { type: 'refund', cents: 17779 }));
    expect(part).toMatchObject({ status: 'partly_refunded', refundedCents: 17779 });
    expect(orderStatus({ totalCents: 22779, voided: false }, [part]).status).toBe('partly_refunded');
    const rest = must(tenderTransition(part, { type: 'refund', cents: 5000 }));
    expect(rest.status).toBe('refunded');
    expect(orderStatus({ totalCents: 22779, voided: false }, [rest]).status).toBe('refunded');
  });
  test('never more than was paid', () => {
    const approved = must(tenderTransition(cash({ amountCents: 3879 }), { type: 'approve' }));
    expect(tenderTransition(approved, { type: 'refund', cents: 3880 }).ok).toBe(false);
  });
  test('an uncaptured card is voided instead', () => {
    const authorised = must(tenderTransition(card(), { type: 'authorise' }));
    expect(tenderTransition(authorised, { type: 'refund', cents: 100 })).toEqual({ ok: false, reason: 'An uncaptured card is voided, not refunded.' });
  });
  test('a Clear refund is the protocol’s, not this machine’s (the seam)', () => {
    const clear = must(tenderTransition({ method: 'clear', status: 'pending', amountCents: 41200, tipCents: 0, refundedCents: 0 }, { type: 'approve' }));
    expect(tenderTransition(clear, { type: 'refund', cents: 41200 }).ok).toBe(false);
  });
});

describe('schemas', () => {
  test('money is whole cents', () => {
    expect(Cents.safeParse(1250).success).toBe(true);
    expect(Cents.safeParse(12.5).success).toBe(false);
  });
  test('a discount code is a percent or an amount, never both', () => {
    const base = { id: 'dc_1', code: 'FALL10', appliesTo: { all: true as const }, startsAt: null, endsAt: null, oncePerCustomer: false, uses: 0 };
    expect(DiscountCode.safeParse({ ...base, percent: 10, amountCents: null }).success).toBe(true);
    expect(DiscountCode.safeParse({ ...base, percent: 10, amountCents: 500 }).success).toBe(false);
  });
  test('before both counts are saved, a view carries no one else’s figure and no expected total', () => {
    const leaked = {
      state: 'awaiting_second',
      mine: { id: 'cnt_1', counter: 'stf_luis', method: 'total', notes: null, totalCents: 20800, second: false, savedAt: '2026-09-22T17:50:00-07:00' },
      expectedCents: 21179,
      other: { totalCents: 21179 },
    };
    const parsed = CountsView.parse(leaked);
    expect(parsed).not.toHaveProperty('expectedCents');
    expect(parsed).not.toHaveProperty('other');
  });
});
