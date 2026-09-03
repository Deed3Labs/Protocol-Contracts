import { describe, expect, it } from 'bun:test';
import { compactMoney, count, credits, dollars, money, signedMoney } from './money';

describe('the merchant convention: transactions are exact', () => {
  it('always carries decimals, including on a round figure', () => {
    expect(dollars(412)).toBe('$412.00');
    expect(dollars(2400)).toBe('$2,400.00');
    expect(dollars(0)).toBe('$0.00');
  });

  it('matches every figure the design reference prints', () => {
    expect(dollars(940)).toBe('$940.00');
    expect(dollars(401.7)).toBe('$401.70');
    expect(dollars(99.91)).toBe('$99.91');
    expect(dollars(3808.3)).toBe('$3,808.30');
    expect(dollars(8.24)).toBe('$8.24');
  });
});

describe('the member convention: balances read round', () => {
  it('drops cents on a whole figure, keeps them when they carry meaning', () => {
    expect(money(3200)).toBe('$3,200');
    expect(money(52.1)).toBe('$52.10');
  });

  it('can be forced either way', () => {
    expect(money(3200, { cents: true })).toBe('$3,200.00');
    expect(money(52.1, { cents: false })).toBe('$52');
  });
});

describe('credits are whole, and still in dollars', () => {
  it('takes no decimals but keeps the symbol', () => {
    expect(credits(15000)).toBe('$15,000');
    expect(credits(1)).toBe('$1');
  });

  it('count gives the bare number for callers supplying their own unit', () => {
    expect(count(15000)).toBe('15,000');
  });
});

describe('rules that hold across every formatter', () => {
  it('never renders a negative — direction is a sign at the call site', () => {
    expect(dollars(-412)).toBe('$412.00');
    expect(money(-40)).toBe('$40');
    expect(compactMoney(-740_000)).toBe('$740k');
  });

  it('signs with a true minus, not a hyphen', () => {
    expect(signedMoney(-52.1)).toBe('−$52.10');
    expect(signedMoney(2000)).toBe('+$2,000.00');
  });

  it('abbreviates only at pool scale', () => {
    expect(compactMoney(740_000)).toBe('$740k');
    expect(compactMoney(1_000_000)).toBe('$1.0M');
  });
});
