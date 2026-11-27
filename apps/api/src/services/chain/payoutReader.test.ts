import { describe, expect, test } from 'bun:test';
import { freeNow, microsToCents } from './payoutReader.js';

const usdc = (v: string) => BigInt(Math.round(Number(v) * 1_000_000));

/*
 * What a shop can have today, and why the answer is usually less than what the pool holds.
 *
 * `payoutPosition` carried `availableTodayCents = null` with a note that the credit side answers
 * this and nothing off-chain should guess. These are that answer's edges — the cases where a
 * plausible guess (held, or owed, or the smaller of the two) would be wrong and a shop would be
 * told they can have money that belongs to somebody else.
 */
describe('what the payout pool can free today', function () {
  test('is what is owed when the pool covers it', function () {
    expect(freeNow({ held: usdc('200'), queued: 0n, refundsOwed: 0n, redeemable: usdc('97.5') })).toBe(
      usdc('97.5'),
    );
  });

  test('is what is there when the pool does not', function () {
    expect(freeNow({ held: usdc('6'), queued: 0n, refundsOwed: 0n, redeemable: usdc('97.5') })).toBe(usdc('6'));
  });

  test('is nothing while a claim is queued ahead that takes the lot', function () {
    // The pool pays in age order, always. Cash that a queued claim will take is not this shop's
    // to withdraw, however much is sitting there.
    expect(freeNow({ held: usdc('100'), queued: usdc('100'), refundsOwed: 0n, redeemable: usdc('50') })).toBe(0n);
  });

  test('counts only what is left after the queue ahead', function () {
    expect(freeNow({ held: usdc('100'), queued: usdc('70'), refundsOwed: 0n, redeemable: usdc('50') })).toBe(
      usdc('30'),
    );
  });

  test('leaves a member their refund before any merchant is paid', function () {
    // Money already belonging to a member is not the pool's to pay a claim with.
    expect(freeNow({ held: usdc('50'), queued: 0n, refundsOwed: usdc('46'), redeemable: usdc('50') })).toBe(
      usdc('4'),
    );
  });

  test('never goes negative when the pool is over-committed', function () {
    expect(freeNow({ held: usdc('10'), queued: usdc('80'), refundsOwed: usdc('20'), redeemable: usdc('50') })).toBe(
      0n,
    );
  });
});

describe('micros to cents', function () {
  test('truncates rather than rounding', function () {
    // 1.239999 is a dollar twenty-three a shop can withdraw, not a dollar twenty-four they cannot.
    expect(microsToCents(1_239_999n)).toBe(123);
    expect(microsToCents(usdc('97.5'))).toBe(9750);
    expect(microsToCents(0n)).toBe(0);
  });
});
