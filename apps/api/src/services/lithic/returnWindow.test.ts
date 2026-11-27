import { describe, expect, test } from 'bun:test';
import { RETURN_WINDOW_DAYS } from './achOriginationService.js';
import { tierLimits } from './tierLimits.js';

/*
 * The rule that stops a clawed-back deposit from having collateralised a credit line. These are the
 * arithmetic parts of it — the store and the job are exercised against a real database.
 */

describe('return windows', () => {
  test('consumer debits carry the sixty-day unauthorized window', () => {
    // R05, R07, R10, R11, R51 can come back for 60 days on a consumer account.
    expect(RETURN_WINDOW_DAYS.unauthorized).toBe(60);
  });

  test('the standard window covers administrative and NSF returns', () => {
    expect(RETURN_WINDOW_DAYS.standard).toBe(5);
  });

  test('the unauthorized window is the longer of the two, by a lot', () => {
    // If these ever converge, someone has decided consumer debits are as safe as business ones.
    expect(RETURN_WINDOW_DAYS.unauthorized).toBeGreaterThan(RETURN_WINDOW_DAYS.standard * 10);
  });
});

describe('pending collateral is withheld', () => {
  const savingsCents = 300_000;

  test('money still inside its window does not back credit', () => {
    // $3,000 in savings, $1,000 of it pulled three days ago and still returnable.
    const withheld = tierLimits({
      savingsCents: savingsCents - 100_000,
      bondsWorthCents: 0,
      poolPositionCents: 0,
      monthlyDepositCents: 0,
      boostLimitCents: 0,
    });
    expect(withheld.savingsCents).toBe(200_000);
  });

  test('once the window closes the full balance backs credit again', () => {
    const released = tierLimits({
      savingsCents,
      bondsWorthCents: 0,
      poolPositionCents: 0,
      monthlyDepositCents: 0,
      boostLimitCents: 0,
    });
    expect(released.savingsCents).toBe(300_000);
  });

  test('a pull larger than the balance cannot push the limit negative', () => {
    const overdrawn = tierLimits({
      savingsCents: Math.max(0, 100_000 - 250_000),
      bondsWorthCents: 0,
      poolPositionCents: 0,
      monthlyDepositCents: 0,
      boostLimitCents: 0,
    });
    expect(overdrawn.savingsCents).toBe(0);
  });
});
