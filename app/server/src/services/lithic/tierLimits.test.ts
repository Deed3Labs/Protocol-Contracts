import { describe, expect, test } from 'bun:test';
import { BOND_LTV, POOL_LTV, tierAvailability, tierLimits, type CollateralInputs } from './tierLimits.js';

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

describe("the chain overriding the off-chain arithmetic", () => {
  const base = {
    savingsCents: 100_00,
    bondsWorthCents: 200_00,
    poolPositionCents: 100_00,
    monthlyDepositCents: 400_00,
    boostLimitCents: 0,
  };

  test("prefers the chain's ceiling over the local loan-to-values", () => {
    // LimitCalculator applies the registry's governed haircut to a valuation that moves -- a bond
    // accretes daily toward face -- so 95% of a stale balance and 95% of today's present value are
    // different numbers. The contracts enforce the second one.
    const limits = tierLimits({ ...base, chainSavingsCents: 90_00, chainAssetCents: 250_00 });
    expect(limits.savingsCents).toBe(90_00);
    expect(limits.assetCents).toBe(250_00);
  });

  test("falls back to the local arithmetic where the chain says nothing", () => {
    // An undeployed calculator, or a read that failed, must not read as "no collateral".
    const limits = tierLimits(base);
    expect(limits.savingsCents).toBe(100_00);
    expect(limits.assetCents).toBe(200_00 * BOND_LTV + 100_00 * POOL_LTV);
  });

  test("still leaves income and boost to the off-chain rules", () => {
    // Neither exists on-chain: both are underwritten off-chain and arrive as attestations, so the
    // chain has no ceiling to offer and none should be invented from one.
    const limits = tierLimits({ ...base, chainSavingsCents: 1, chainAssetCents: 1, boostLimitCents: 500_00 });
    expect(limits.incomeCents).toBe(200_00);
    expect(limits.boostCents).toBe(500_00);
  });

  test("takes zero from the chain as a real answer, not a missing one", () => {
    // A member who has pledged nothing has a ceiling of zero, and `?? ` has to let that through --
    // `||` would silently fall back to the local figure and lend against collateral the registry
    // does not have.
    const limits = tierLimits({ ...base, chainSavingsCents: 0, chainAssetCents: 0 });
    expect(limits.savingsCents).toBe(0);
    expect(limits.assetCents).toBe(0);
  });
});
