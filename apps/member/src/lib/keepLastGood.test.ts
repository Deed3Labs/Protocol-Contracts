import { describe, expect, test } from 'bun:test';
import { keepLastGood } from './keepLastGood';

/*
 * Reported twice as the credit component "showing the wrong thing" after a deposit or withdrawal.
 *
 * Not staleness. Under RPC rate limiting a share of reads errored, and the client assigned the
 * failure on top of the good value, so the limit fell to zero and returned on the next success.
 */
type Reading = { complete: boolean; limit: number };
const good = (limit: number): Reading => ({ complete: true, limit });
const failed: Reading = { complete: false, limit: 0 };

describe('keepLastGood', () => {
  test('a failed request does not replace a good reading', () => {
    // getCredit returns null when the request itself fails -- the most common failure, and it blanked.
    expect(keepLastGood(good(350), null)).toEqual(good(350));
  });

  test('an incomplete read does not replace a good reading', () => {
    expect(keepLastGood(good(350), failed)).toEqual(good(350));
  });

  test('a good read always wins', () => {
    expect(keepLastGood(good(350), good(400))).toEqual(good(400));
  });

  test('an empty account is a real answer, not a failure', () => {
    /*
     * The distinction the whole helper rests on. A member with nothing reads as complete with zero,
     * and that must be shown -- otherwise closing an account would leave the old figure on screen
     * forever.
     */
    expect(keepLastGood(good(350), good(0))).toEqual(good(0));
  });

  test('with nothing good to keep, an incomplete read is still the best available', () => {
    expect(keepLastGood(null, failed)).toEqual(failed);
    expect(keepLastGood(failed, failed)).toEqual(failed);
  });

  test('a failure with no previous value stays empty rather than inventing one', () => {
    expect(keepLastGood(null, null)).toBeNull();
  });
});
