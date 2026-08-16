import { describe, expect, test } from 'bun:test';
import { tierAvailability, tierLimits, type CollateralInputs } from './tierLimits.js';

/*
 * The collateral model decides how much unsecured credit a member is offered, so the loan-to-values
 * and the "an offer is not a limit" rule are worth pinning down.
 */

const none: CollateralInputs = {
  savingsCents: 0,
  bondsWorthCents: 0,
  poolPositionCents: 0,
  monthlyDepositCents: 0,
  boostLimitCents: 0,
};

/** The app's own fixture, in cents: $3,000 CLRUSD, $6,895 of bonds, $2,500 in the pool, $2,000/mo. */
const member: CollateralInputs = {
  savingsCents: 300_000,
  bondsWorthCents: 689_500,
  poolPositionCents: 250_000,
  monthlyDepositCents: 200_000,
  boostLimitCents: 0,
};

describe('limits', () => {
  test('savings backs itself, pound for pound', () => {
    expect(tierLimits({ ...none, savingsCents: 300_000 }).savingsCents).toBe(300_000);
  });

  test('asset-backed is 95% of bonds plus 70% of the pool', () => {
    // 689,500 × 0.95 = 655,025; 250,000 × 0.70 = 175,000 → 830,025 ≈ the $8,300 the app shows.
    expect(tierLimits(member).assetCents).toBe(830_025);
  });

  test('income-backed is half a month, never a whole one', () => {
    expect(tierLimits(member).incomeCents).toBe(100_000);
  });

  test('boost is zero until it is opted into — an offer is not a limit', () => {
    expect(tierLimits(member).boostCents).toBe(0);
    expect(tierLimits({ ...member, boostLimitCents: 50_000 }).boostCents).toBe(50_000);
  });

  test('a member with nothing gets nothing', () => {
    expect(tierLimits(none)).toEqual({
      savingsCents: 0,
      assetCents: 0,
      incomeCents: 0,
      boostCents: 0,
    });
  });
});

describe('availability', () => {
  test('room is the limit less what is drawn', () => {
    const limits = tierLimits(member);
    const available = tierAvailability(limits, {
      savings: 300_000,
      asset: 240_000,
      income: 0,
      boost: 0,
    });
    expect(available.savingsCents).toBe(0);
    expect(available.assetCents).toBe(590_025);
    expect(available.incomeCents).toBe(100_000);
  });

  test('a tier drawn past its limit reads as zero, never negative', () => {
    // Collateral can fall after a draw — a bond matures, a pool position is withdrawn.
    const available = tierAvailability(
      { savingsCents: 100_000, assetCents: 0, incomeCents: 0, boostCents: 0 },
      { savings: 250_000, asset: 0, income: 0, boost: 0 },
    );
    expect(available.savingsCents).toBe(0);
  });

  test('an over-drawn tier cannot offset another tier in the total', () => {
    const available = tierAvailability(
      { savingsCents: 0, assetCents: 500_000, incomeCents: 0, boostCents: 0 },
      { savings: 900_000, asset: 0, income: 0, boost: 0 },
    );
    const total =
      available.savingsCents + available.assetCents + available.incomeCents + available.boostCents;
    expect(total).toBe(500_000);
  });
});
