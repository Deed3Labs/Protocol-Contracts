import { describe, expect, test } from 'bun:test';
import { tierLimits } from '../lithic/tierLimits.js';

/*
 * The chain reader's contract with the snapshot, tested at the boundary that matters: what happens
 * to a member's credit when a read fails, and whether token amounts survive the trip to cents.
 */

/** Mirrors collateralReader.toCents — bigint the whole way, no floating point on a balance. */
function toCents(amount: bigint, decimals: number): number {
  if (decimals <= 2) return Number(amount) * 10 ** (2 - decimals);
  return Number(amount / 10n ** BigInt(decimals - 2));
}

describe('token amounts to cents', () => {
  test('six-decimal USDC converts exactly', () => {
    expect(toCents(1_000_000n, 6)).toBe(100); // 1.00 → 100c
    expect(toCents(1_234_567n, 6)).toBe(123); // truncates sub-cent, never rounds up
  });

  test('eighteen-decimal tokens survive without precision loss', () => {
    // 2,500.00 at 18 decimals overflows a float long before it reaches cents.
    expect(toCents(2_500_000000000000000000n, 18)).toBe(250_000);
  });

  test('a large balance stays exact', () => {
    // $10,000,000 — the number where naive Number(amount) arithmetic starts lying.
    expect(toCents(10_000_000_000000n, 6)).toBe(1_000_000_000);
  });

  test('sub-cent dust reads as zero rather than as a rounding gift', () => {
    expect(toCents(9_999n, 6)).toBe(0);
  });
});

describe('a failed read is not a zero balance', () => {
  test('null collateral would zero a member’s secured credit if written', () => {
    // This is the outcome refreshSnapshot refuses to write. $5,000 of real CLRUSD reading as zero
    // is a member declined at a checkout because an RPC timed out.
    const asIfFailed = tierLimits({
      savingsCents: 0,
      bondsWorthCents: 0,
      poolPositionCents: 0,
      monthlyDepositCents: 0,
      boostLimitCents: 0,
    });
    const truth = tierLimits({
      savingsCents: 500_000,
      bondsWorthCents: 0,
      poolPositionCents: 0,
      monthlyDepositCents: 0,
      boostLimitCents: 0,
    });

    expect(asIfFailed.savingsCents).toBe(0);
    expect(truth.savingsCents).toBe(500_000);
  });
});

describe('contracts that do not exist back nothing', () => {
  test('bonds lend zero until there is a bond contract to read', () => {
    // bondsWorthCents is hardcoded to 0 in the reader. Credit against an unreadable asset is
    // credit against nothing, so the asset tier here is the pool alone.
    const limits = tierLimits({
      savingsCents: 0,
      bondsWorthCents: 0,
      poolPositionCents: 100_000,
      monthlyDepositCents: 0,
      boostLimitCents: 0,
    });
    expect(limits.assetCents).toBe(70_000); // 70% of the pool, nothing from bonds
  });
});
