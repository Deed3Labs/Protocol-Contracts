import { describe, expect, it } from 'bun:test';
import { merchantFee, merchantPayout, payoutSettlement } from './merchant';
import { refundQuote } from './refund';

describe('what the shop receives', () => {
  it('matches the reference: $940 at 2.5% is $23.50 fee, $916.50 received', () => {
    expect(merchantFee(940, 0.025)).toBeCloseTo(23.5, 10);
    expect(merchantPayout(940, 0.025)).toBeCloseTo(916.5, 10);
  });

  it('and $412 at 2.5% is $10.30 fee, $401.70 received', () => {
    expect(merchantFee(412, 0.025)).toBeCloseTo(10.3, 10);
    expect(merchantPayout(412, 0.025)).toBeCloseTo(401.7, 10);
  });

  it('fee and payout always reconstruct the charge', () => {
    for (const a of [940, 412, 188, 300, 0.01]) {
      expect(merchantFee(a, 0.025) + merchantPayout(a, 0.025)).toBeCloseTo(a, 10);
    }
  });

  it('a refund claws back exactly what the charge paid out', () => {
    const q = refundQuote({
      amount: 412,
      splitInto: 4,
      ratePerCycle: 0.02,
      cyclesCleared: 1,
      discountRate: 0.025,
      nextPayout: 4210,
    });
    // The same function behind both screens: what was received is what is given back.
    expect(q.merchantClawback).toBeCloseTo(merchantPayout(412, 0.025), 10);
  });
});

describe('how a payout settles', () => {
  it('matches the reference: $4,210.00 owed, $1,180.00 carried', () => {
    const s = payoutSettlement(4210, 1180);
    expect(s.clearsBalance).toBeCloseTo(1180, 10);
    expect(s.toBank).toBeCloseTo(3030, 10);
  });

  it('the parts always reconstruct the total — a merchant will add them up', () => {
    for (const [owed, bal] of [[4210, 1180], [900, 0], [500, 2000], [0, 100]] as const) {
      const s = payoutSettlement(owed, bal);
      expect(s.clearsBalance + s.toBank).toBeCloseTo(owed, 10);
    }
  });

  it('a balance bigger than the payout clears only as far as the payout goes', () => {
    const s = payoutSettlement(500, 2000);
    expect(s.clearsBalance).toBe(500);
    expect(s.toBank).toBe(0);
  });

  it('carrying nothing sends the whole payout to the bank', () => {
    expect(payoutSettlement(900, 0).toBank).toBe(900);
  });
});
