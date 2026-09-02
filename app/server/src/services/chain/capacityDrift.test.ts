import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const reader = strip(readFileSync(join(import.meta.dirname, 'creditReader.ts'), 'utf8'));

/*
 * The invariant that broke.
 *
 * A member's savings limit read $350 against $325 of savings. The pledge had tracked their
 * withdrawal correctly; the `pushCapacities` that should have followed it never landed. Because the
 * issuer's written capacity is what gates a draw, the line was under-collateralised rather than
 * merely mislabelled — and nothing anywhere noticed. It surfaced because a person looked at the
 * screen and thought the number was wrong.
 */
describe('a limit is never more than the collateral supports', () => {
  test('the reader asks the calculator what the collateral supports now', () => {
    // The issuer holds what was last written; the calculator computes it live. Reading only the
    // issuer is what made the drift invisible.
    expect(reader).toContain('calculator.capacityOf(wallet, kind)');
  });

  test('and shows the LOWER of the two', () => {
    // Taking the smaller means a stale issuer can only under-state a limit, never offer credit
    // nothing backs. Max() here would be the whole bug, restored.
    expect(reader).toContain('const limit = live !== null && live < written ? live : written;');
    expect(reader).not.toMatch(/Math\.max\(.*written/);
  });

  test('a drift is logged, because it repairs itself only if something notices', () => {
    expect(reader).toContain('capacity drift');
  });

  test('both figures are reported, so a stale limit is distinguishable from a small one', () => {
    expect(reader).toContain('writtenLimitCents');
  });

  test('a kind the calculator does not know is not treated as a drift', () => {
    // An unregistered kind returns nothing; the issuer's figure stands rather than collapsing to 0.
    const block = reader.slice(reader.indexOf('let live: bigint | null = null;'), reader.indexOf('const limit ='));
    expect(block).toContain('catch');
    expect(block).toContain('live: bigint | null');
  });

  test('the calculator address is actually passed in, not silently null', () => {
    // The guard is worthless if the argument never arrives — this is the wiring, not the intent.
    expect(reader).toContain("getContractAddress(chainId, 'LimitCalculator')");
    expect(reader).toMatch(/readTiers\(provider, issuer, wallet, registry, limitCalculator\)/);
  });
});
