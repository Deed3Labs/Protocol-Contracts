import { describe, expect, test } from 'bun:test';
import { advancesOutstanding, daysInMonth, feeOn, interchangeShare, monthFee, previousMonth, toUnits, usd } from './feeMath';

const USDC = 1_000_000n;
const flat = (month: string, coverage: bigint, days?: string[]) =>
  new Map((days ?? Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)).map((d) => [d, { coverage }]));

describe('the Credit Enhancement Fee: 8% a year on average daily Available Coverage, actual/365', () => {
  test('a full month at a steady $10,000 is 30/365 of 8%', () => {
    const b = monthFee('2026-11', flat('2026-11', 10_000n * USDC), 800n);
    // 10,000 × 30 days × 0.08 / 365 = 65.753424…
    expect(b.fee).toBe('65753424');
    expect(b).toMatchObject({ days: 30, read: 30, zero: 0, filled: 0, sum: (300_000n * USDC).toString(), average: (10_000n * USDC).toString(), bps: 800 });
  });

  test('a partial month: days the pool did not exist count as zero, and the average is over the whole month', () => {
    const late = Array.from({ length: 10 }, (_, i) => `2026-11-${String(21 + i).padStart(2, '0')}`);
    const b = monthFee('2026-11', flat('2026-11', 9_000n * USDC, late), 800n);
    expect(b.read).toBe(10);
    expect(b.zero).toBe(20);
    expect(b.sum).toBe((90_000n * USDC).toString());
    expect(b.average).toBe((3_000n * USDC).toString());
    // 90,000 coverage-days × 0.08 / 365 = 19.726027…
    expect(b.fee).toBe('19726027');
  });

  test('missing days in the middle are zero, and filled days are counted and marked', () => {
    const m = flat('2026-10', 1_000n * USDC);
    m.delete('2026-10-05');
    m.delete('2026-10-06');
    m.set('2026-10-07', { coverage: 1_000n * USDC, filled: true } as any);
    const b = monthFee('2026-10', m, 800n);
    expect(b).toMatchObject({ days: 31, read: 29, zero: 2, filled: 1 });
    expect(b.sum).toBe((29_000n * USDC).toString());
  });

  test('zero coverage is a zero fee', () => {
    expect(monthFee('2026-11', flat('2026-11', 0n), 800n).fee).toBe('0');
    expect(monthFee('2026-11', new Map(), 800n)).toMatchObject({ fee: '0', read: 0, zero: 30, sum: '0', average: '0' });
  });

  test('rounds down, once, to the base unit', () => {
    // 1 base unit for 365 days at 8%: 0.08 of a unit, so nothing
    expect(feeOn(365n, 800n)).toBe(0n);
    // 3,650,000 coverage-units·days at 8% / 365 = exactly 800 units
    expect(feeOn(3_650_000n * 1_000n, 800n)).toBe(800_000n);
    // one unit less rounds down
    expect(feeOn(3_650_000n * 1_000n - 1n, 800n)).toBe(799_999n);
    // never more than the exact fee
    for (const sum of [1n, 12_345n, 999_999_999n, 7_777_777_777_777n]) expect(feeOn(sum, 800n) * 3_650_000n <= sum * 800n).toBe(true);
  });

  test('a leap year is not special: February 2028 is 29 days, each 1/365 of a year', () => {
    expect(daysInMonth('2028-02')).toBe(29);
    const b = monthFee('2028-02', flat('2028-02', 3_650n * USDC), 800n);
    // 3,650 × 29 × 0.08 / 365 = 23.2 exactly
    expect(b.fee).toBe((232n * USDC) / 10n + '');
    expect(b.days).toBe(29);
  });

  test('readings outside the month are ignored', () => {
    const m = flat('2026-11', 100n * USDC);
    m.set('2026-12-01', { coverage: 1_000_000n * USDC });
    m.set('2026-10-31', { coverage: 1_000_000n * USDC });
    expect(monthFee('2026-11', m, 800n).sum).toBe((3_000n * USDC).toString());
  });

  test('the rate is config: 400 bps is half the fee', () => {
    const at800 = BigInt(monthFee('2026-11', flat('2026-11', 10_000n * USDC), 800n).fee);
    const at400 = BigInt(monthFee('2026-11', flat('2026-11', 10_000n * USDC), 400n).fee);
    expect(at400 * 2n - at800 <= 1n).toBe(true);
  });
});

describe('the other figures', () => {
  test('interchange at 25%, rounded down', () => {
    expect(interchangeShare(1_234_567_891n, 2500n)).toBe(308_641_972n);
    expect(interchangeShare(3n, 2500n)).toBe(0n);
  });

  test('advances outstanding never go below zero', () => {
    expect(advancesOutstanding(500n, 200n)).toBe(300n);
    expect(advancesOutstanding(100n, 200n)).toBe(0n);
  });

  test('dollars typed by a person to base units, and back', () => {
    expect(toUnits(12.34)).toBe(12_340_000n);
    expect(toUnits('0.000001')).toBe(1n);
    expect(() => toUnits('1.0000001')).toThrow();
    expect(() => toUnits('-1')).toThrow();
    expect(usd(1_234_567_891n)).toBe('$1,234.56');
  });

  test('months', () => {
    expect(previousMonth('2027-01')).toBe('2026-12');
    expect(daysInMonth('2026-02')).toBe(28);
  });
});
