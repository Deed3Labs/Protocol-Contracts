import { describe, expect, it } from 'bun:test';
import { fromCents, toCents } from './units';

describe('the cents boundary', () => {
  it('converts both ways', () => {
    expect(fromCents(41200)).toBe(412);
    expect(toCents(412)).toBe(41200);
  });

  it('rounds the float error that would otherwise reach an integer column', () => {
    // 4.1 * 100 is 409.99999999999994 in binary floating point.
    expect(toCents(4.1)).toBe(410);
    // 1.005 * 100 is 100.49999999999999, which a bare Math.round sends DOWN to 100.
    expect(toCents(1.005)).toBe(101);
    expect(Number.isInteger(toCents(0.07 * 3))).toBe(true);
    expect(toCents(0.07 * 3)).toBe(21);
  });

  it('always yields an integer, whatever the float did', () => {
    for (const v of [0.1 + 0.2, 4.1, 1.005, 108.15, 1e6 / 3]) {
      expect(Number.isInteger(toCents(v))).toBe(true);
    }
  });

  it('round-trips the figures both apps quote', () => {
    for (const v of [412, 940, 108.15, 99.91, 8.24, 3808.3, 0]) {
      expect(fromCents(toCents(v))).toBeCloseTo(v, 10);
    }
  });
});
