import { describe, expect, test } from 'bun:test';
import { isOfferedPlanSplit, quotePlan, resplitCostRises, type RateProductParams } from './planQuote';

const CA = '0x4341000000000000000000000000000000000000000000000000000000000000';
const ZERO = `0x${'0'.repeat(64)}`;
const DAY = 86_400n;
const USD = 1_000_000n;

// deploy/config/rate-schedule.json, PARTNER in CA: freeInFull, $2,500 large-loan threshold, 365-day minimum.
const PARTNER: RateProductParams = {
  enabled: true,
  largeLoanThreshold: 2_500n * USD,
  minTermSeconds: 365n * DAY,
  freeInFull: true,
  freeBelowAmount: 0n,
  freeSplitMax: 0,
};
const NO_MERCHANT_TERMS = { discountBps: 300n, subsidyBps: 0n, freeSplitMax: 0 };

const quote = (over: Partial<Parameters<typeof quotePlan>[0]> = {}) =>
  quotePlan({
    stateCode: CA,
    params: PARTNER,
    merchant: NO_MERCHANT_TERMS,
    effectiveMonthlyBps: 200n,
    principal: 940n * USD,
    installments: 4,
    installmentLengthSeconds: 30n * DAY,
    ...over,
  });

describe('TermIssuerBase._quote, from what it reads', () => {
  test('no attested state is refused as such', () => {
    expect(quote({ stateCode: ZERO })).toEqual({ ok: false, refusal: { kind: 'state_not_confirmed' } });
  });

  test('a product off in the state is refused', () => {
    expect(quote({ params: { ...PARTNER, enabled: false } })).toEqual({ ok: false, refusal: { kind: 'product_not_enabled', stateCode: CA } });
    expect(quote({ params: null }).ok).toBe(false);
  });

  test('charged: min(list, cap) less subsidy, and the payout after the split’s discount, in units', () => {
    const q = quote({ merchant: { discountBps: 333n, subsidyBps: 50n, freeSplitMax: 0 }, principal: 123_450_000n });
    expect(q).toEqual({
      ok: true,
      quote: { rateBps: 150n, payout: 123_450_000n - (123_450_000n * 333n) / 10_000n, free: false, largeLoan: false, subsidyBps: 50n },
    });
  });

  test('the free rules: in full, under freeBelowAmount, a short split at the schedule or the merchant', () => {
    const free = (over: Partial<Parameters<typeof quotePlan>[0]>) => {
      const q = quote(over);
      return q.ok ? [q.quote.free, q.quote.rateBps] : null;
    };
    expect(free({ installments: 1 })).toEqual([true, 0n]);
    expect(free({ installments: 1, params: { ...PARTNER, freeInFull: false } })).toEqual([false, 200n]);
    expect(free({ params: { ...PARTNER, freeBelowAmount: 1_000n * USD } })).toEqual([true, 0n]);
    expect(free({ params: { ...PARTNER, freeSplitMax: 4 } })).toEqual([true, 0n]);
    expect(free({ merchant: { ...NO_MERCHANT_TERMS, freeSplitMax: 4 } })).toEqual([true, 0n]);
    expect(free({ merchant: { ...NO_MERCHANT_TERMS, freeSplitMax: 2 } })).toEqual([false, 200n]);
    // A subsidy that covers the whole rate makes it free.
    expect(free({ merchant: { ...NO_MERCHANT_TERMS, subsidyBps: 200n } })).toEqual([true, 0n]);
  });

  test('a large loan needs the minimum term (Clear Cash: 13 thirty-day cycles, DECISIONS #4)', () => {
    expect(quote({ principal: 2_500n * USD, installments: 12 })).toEqual({
      ok: false,
      refusal: { kind: 'term_too_short', termSeconds: 360n * DAY, minimumSeconds: 365n * DAY },
    });
    const ok = quote({ principal: 2_500n * USD, installments: 13 });
    expect(ok.ok && ok.quote.largeLoan).toBe(true);
    expect(isOfferedPlanSplit(13)).toBe(false);
    expect(isOfferedPlanSplit(13, true)).toBe(true);
  });
});

describe('when a re-split needs the member’s signature (_resplit)', () => {
  test('a higher rate, or a charged plan spread longer than it has left', () => {
    expect(resplitCostRises({ oldRateBps: 0n, newRateBps: 200n, installments: 4, remainingInstallments: 4 })).toBe(true);
    expect(resplitCostRises({ oldRateBps: 200n, newRateBps: 200n, installments: 12, remainingInstallments: 3 })).toBe(true);
    expect(resplitCostRises({ oldRateBps: 200n, newRateBps: 200n, installments: 2, remainingInstallments: 3 })).toBe(false);
    expect(resplitCostRises({ oldRateBps: 200n, newRateBps: 0n, installments: 12, remainingInstallments: 3 })).toBe(false);
  });
});
