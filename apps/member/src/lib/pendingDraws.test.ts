import { describe, expect, test } from 'bun:test';
import { toCreditTiers } from './creditMapping';
import type { CreditTierRow } from '@/utils/apiClient';

const row = (kind: string, limitCents: number, usedCents = 0): CreditTierRow =>
  ({
    kind,
    limitCents,
    writtenLimitCents: limitCents,
    usedCents,
    principalCents: usedCents,
    carryCents: 0,
    rateBps: 75,
    collateralValueCents: limitCents,
    haircutBps: 0,
    active: true,
  }) as CreditTierRow;

/*
 * A card authorization is a hold, not a settled borrow — the contracts do not carry it and are
 * right not to, since it can still be voided. But the member cannot spend it twice from the moment
 * it is approved, and every page read only the chain: a live $5 charge sat against a line reading
 * "$0 used · not drawn".
 */
describe('a held authorization counts as drawn', () => {
  test('pending is added to what the tier shows as used', () => {
    const [tier] = toCreditTiers([row('SAVINGS', 43_144)], { savings: 500 });
    expect(tier.used).toBe(5);
    expect(tier.pending).toBe(5);
  });

  test('it stacks on top of what the chain has settled', () => {
    const [tier] = toCreditTiers([row('SAVINGS', 43_144, 2_000)], { savings: 500 });
    expect(tier.used).toBe(25);
    expect(tier.pending).toBe(5);
  });

  test('a tier with no hold is untouched and says nothing about pending', () => {
    const [tier] = toCreditTiers([row('SAVINGS', 43_144, 2_000)], {});
    expect(tier.used).toBe(20);
    expect(tier.pending).toBeUndefined();
  });

  /*
   * Two chain kinds collapse into one Assets row, and a draw is recorded against the page tier the
   * waterfall chose — not against a collateral kind. Adding per row would double-count it.
   */
  test('a hold on a collapsed tier is counted once, not per kind', () => {
    const tiers = toCreditTiers([row('BOND', 18_456), row('POOL_SHARE', 22_400)], { asset: 500 });
    const assets = tiers.find((t) => t.key === 'asset');
    expect(assets?.limit).toBe(408.56);
    expect(assets?.used).toBe(5);
    expect(assets?.pending).toBe(5);
  });

  test('a hold on a tier the chain never reported is dropped, not invented', () => {
    // Boost is opt-in. A hold against a tier with no row would otherwise conjure one.
    const tiers = toCreditTiers([row('SAVINGS', 43_144)], { boost: 900 });
    expect(tiers.find((t) => t.key === 'boost')).toBeUndefined();
  });
});
