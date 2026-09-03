import { describe, expect, test } from 'bun:test';
import { autoSaveCentsFor, type AutoSaveRule } from './autoSaveStore.js';

const rule = (over: Partial<AutoSaveRule>): AutoSaveRule => ({
  wallet: '0xabc',
  mode: 'fixed',
  value: 10_000,
  enabled: true,
  updatedAt: '2026-08-16T00:00:00.000Z',
  ...over,
});

/*
 * Auto-save on a deposit. The arithmetic is where the member's money is at stake, so it is tested
 * away from the database that stores the rule.
 */

describe('no rule, no saving', () => {
  test('a member without a rule saves nothing', () => {
    expect(autoSaveCentsFor(null, 200_000)).toBe(0);
  });

  test('a disabled rule saves nothing', () => {
    // Disabled has to mean disabled — not "saves the old amount until deleted".
    expect(autoSaveCentsFor(rule({ enabled: false }), 200_000)).toBe(0);
  });
});

describe('a fixed amount', () => {
  test('saves the amount when the deposit covers it', () => {
    expect(autoSaveCentsFor(rule({ value: 10_000 }), 200_000)).toBe(10_000);
  });

  test('never saves more than is actually left', () => {
    // A paycheck that mostly repaid credit leaves $50. Saving $100 of it would overdraw the member
    // to hit a target, which is a rule that has forgotten what it is for.
    expect(autoSaveCentsFor(rule({ value: 10_000 }), 5_000)).toBe(5_000);
  });

  test('nothing left means nothing saved', () => {
    expect(autoSaveCentsFor(rule({ value: 10_000 }), 0)).toBe(0);
  });

  test('a negative remainder is treated as nothing left', () => {
    expect(autoSaveCentsFor(rule({ value: 10_000 }), -5_000)).toBe(0);
  });
});

describe('a percentage', () => {
  test('saves its share of what is left', () => {
    expect(autoSaveCentsFor(rule({ mode: 'percent', value: 10 }), 200_000)).toBe(20_000);
  });

  test('rounds down, so it never takes a cent more than its share', () => {
    // 10% of $33.33 is 333.3 cents. The member keeps the fraction.
    expect(autoSaveCentsFor(rule({ mode: 'percent', value: 10 }), 3_333)).toBe(333);
  });

  test('a share survives a short paycheck without special handling', () => {
    // The point of percent over fixed: half a paycheck saves half as much, automatically.
    expect(autoSaveCentsFor(rule({ mode: 'percent', value: 20 }), 100_000)).toBe(20_000);
    expect(autoSaveCentsFor(rule({ mode: 'percent', value: 20 }), 50_000)).toBe(10_000);
  });

  test('100% saves everything left but never invents more', () => {
    expect(autoSaveCentsFor(rule({ mode: 'percent', value: 100 }), 80_000)).toBe(80_000);
  });

  test('a nonsense percentage is clamped rather than obeyed', () => {
    expect(autoSaveCentsFor(rule({ mode: 'percent', value: 150 }), 80_000)).toBe(80_000);
  });
});

describe('auto-save runs on the remainder, not the gross', () => {
  test('credit settlement comes first', () => {
    // $2,000 deposit, $1,700 went to settling credit. 10% saves $30, not $200 — the deposit
    // pipeline hands over what is left, and saving on the gross would re-spend money already used.
    const remainingAfterSettlement = 30_000;
    expect(autoSaveCentsFor(rule({ mode: 'percent', value: 10 }), remainingAfterSettlement)).toBe(
      3_000,
    );
  });
});
