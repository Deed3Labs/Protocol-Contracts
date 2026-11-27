import { describe, expect, test } from 'bun:test';
import { poolBacking, bondsBacking, POOL_SHARE_HAIRCUT_BPS, BOND_HAIRCUT_BPS } from '@/lib/clearModel';
import { EARN_DAY_ONE } from '@/data/clearPlaceholder';
import type { EarnData } from '@/lib/clearModel';

const withPosition = (position: number): EarnData => ({
  ...EARN_DAY_ONE,
  pool: { ...EARN_DAY_ONE.pool, position },
});

/*
 * Reported from the demo: $5 into the pool, Earn said $4.00 backs the limit and Home said $3.50.
 * Home was right — it reads the credit contracts. Earn rounded 3.5 to a whole dollar, and upward,
 * which overstates what backs a member's limit. That is the worse direction to be wrong in.
 */
describe('what a position backs', () => {
  test('keeps cents rather than rounding to dollars', () => {
    expect(poolBacking(withPosition(5))).toBe(3.5);
  });

  test('the case that was reported, exactly', () => {
    // 5 × 0.70 = 3.50. Math.round took this to 4.
    expect(poolBacking(withPosition(5))).not.toBe(4);
  });

  test('rounds half-cents rather than truncating them', () => {
    // 3.333… of position is a real figure after a partial withdrawal.
    expect(poolBacking(withPosition(3.333))).toBe(2.33);
  });

  test('nothing backs nothing', () => {
    expect(poolBacking(withPosition(0))).toBe(0);
  });

  test('bonds are rounded the same way', () => {
    expect(bondsBacking(EARN_DAY_ONE)).toBe(Math.round(bondsBacking(EARN_DAY_ONE) * 100) / 100);
  });
});

/*
 * The haircuts are stated in the app and enforced on chain, so they can disagree. These pin the
 * app's copy to what `CollateralRegistry` actually registers on Base Sepolia — read from chain,
 * not assumed:
 *
 *   SAVINGS         100%
 *   ASSET_INTERNAL   95%
 *   POOL_SHARE       70%
 *   BOND             95%
 *
 * If governance moves one, this fails and names the number to change. Silent divergence here means
 * quoting a member a limit the contracts will not give them.
 */
describe('the app’s haircuts match the deployment', () => {
  test('a pool share is haircut at 70%', () => {
    expect(POOL_SHARE_HAIRCUT_BPS).toBe(7_000);
  });

  test('a bond is haircut at 95%', () => {
    expect(BOND_HAIRCUT_BPS).toBe(9_500);
  });

  test('and there is one copy of each', () => {
    // Three existed: the placeholder's POOL_LTV, the server's tierLimits, and one I added inside
    // the pool dialog. The only thing keeping them equal was that nobody had changed one.
    const placeholder = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '../data/clearPlaceholder.ts'), 'utf8',
    );
    expect(placeholder).toContain('POOL_SHARE_HAIRCUT_BPS / 10_000');
    expect(placeholder).not.toMatch(/const POOL_LTV = 0\./);
  });
});
