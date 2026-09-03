import { describe, expect, it } from 'bun:test';
import { merchantFee, merchantPayout } from './merchant';
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
