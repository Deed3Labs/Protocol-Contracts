import { describe, expect, it } from 'bun:test';
import { carryAccrued, refundQuote } from './refund';
import { splitQuote } from './split';

/**
 * The worked refund from the design reference, §16.
 *
 * Marcus T., $412.00, split in 4 at 2% a cycle, one cycle cleared. Every figure on those three
 * screens is asserted here, because the writer's screen and the owner's screen show different
 * numbers for the same refund and both have to be right.
 */
const CHARGE = {
  amount: 412,
  splitInto: 4,
  ratePerCycle: 0.02,
  cyclesCleared: 1,
  discountRate: 0.025,
  nextPayout: 4210,
};

describe('the reference refund: $412.00, split in 4, one cycle cleared', () => {
  it('bills $108.15 a cycle, which is what the plan detail shows', () => {
    expect(splitQuote(412, 4, 0.02).perCycle).toBeCloseTo(108.15, 10);
  });

  it('the writer sees the customer gets back $99.91', () => {
    expect(refundQuote(CHARGE).memberReceives).toBeCloseTo(99.91, 10);
  });

  it('carry the member already paid is $8.24, and the co-op keeps it', () => {
    expect(refundQuote(CHARGE).carryKept).toBeCloseTo(8.24, 10);
  });

  it('the merchant gives back the $401.70 they received, not the $412.00 charged', () => {
    const q = refundQuote(CHARGE);
    expect(q.merchantClawback).toBeCloseTo(401.7, 10);
    // The $10.30 fee was never the merchant's, so it is not theirs to return.
    expect(q.amount - q.merchantClawback).toBeCloseTo(10.3, 10);
  });

  it('the owner sees their next payout become $3,808.30', () => {
    expect(refundQuote(CHARGE).payoutAfter).toBeCloseTo(3808.3, 10);
  });

  it('the two parties see different figures — that is the point of the two screens', () => {
    const q = refundQuote(CHARGE);
    expect(q.memberReceives).not.toBeCloseTo(q.merchantClawback, 2);
  });
});

describe('carry is not refunded — a refund unwinds the purchase, not the time', () => {
  it('the member never gets back more than they paid', () => {
    const q = refundQuote(CHARGE);
    const paid = splitQuote(412, 4, 0.02).perCycle * 1;
    expect(q.memberReceives).toBeLessThan(paid);
    expect(q.memberReceives + q.carryKept).toBeCloseTo(paid, 10);
  });

  it('a member who has paid nothing yet gets nothing back, and keeps no carry', () => {
    const q = refundQuote({ ...CHARGE, cyclesCleared: 0 });
    expect(q.memberReceives).toBeCloseTo(0, 10);
    expect(q.carryKept).toBe(0);
    // The merchant still gives back the whole payout: the purchase is unwound either way.
    expect(q.merchantClawback).toBeCloseTo(401.7, 10);
  });

  it('more cycles cleared means more carry kept', () => {
    const kept = [0, 1, 2, 3, 4].map((n) => refundQuote({ ...CHARGE, cyclesCleared: n }).carryKept);
    for (let i = 1; i < kept.length; i++) expect(kept[i]).toBeGreaterThan(kept[i - 1]);
  });

  it('carry over every cycle equals the carry the plan quoted up front', () => {
    expect(carryAccrued(412, 4, 0.02, 4)).toBeCloseTo(splitQuote(412, 4, 0.02).carry, 10);
  });

  it('accrues on the declining balance: $8.24, $6.18, $4.12, $2.06', () => {
    const per = [1, 2, 3, 4].map(
      (n) => carryAccrued(412, 4, 0.02, n) - carryAccrued(412, 4, 0.02, n - 1),
    );
    expect(per[0]).toBeCloseTo(8.24, 10);
    expect(per[1]).toBeCloseTo(6.18, 10);
    expect(per[2]).toBeCloseTo(4.12, 10);
    expect(per[3]).toBeCloseTo(2.06, 10);
  });

  it('cannot clear more cycles than the plan has', () => {
    expect(carryAccrued(412, 4, 0.02, 99)).toBeCloseTo(carryAccrued(412, 4, 0.02, 4), 10);
  });
});
