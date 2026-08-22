import { describe, expect, test } from 'bun:test';
import { cycleShortfall, securedUsed, unsecuredUsed, type Credit } from './clearModel';

/*
 * What has to clear by the end of a cycle. Getting this wrong either nags a member about money
 * their own collateral already covers, or tells them everything is fine while an unsecured balance
 * runs into the next cycle.
 */

function credit(used: { savings?: number; asset?: number; income?: number; boost?: number }): Credit {
  return {
    carryCost: 0,
    carryFreeUnder: 3000,
    tiers: [
      { key: 'savings', label: 'Savings', rate: 'free', used: used.savings ?? 0, limit: 3000, added: true },
      { key: 'asset', label: 'Asset-backed', rate: '0.65%', used: used.asset ?? 0, limit: 8300, added: true },
      { key: 'income', label: 'Income-backed', rate: '1.5%', used: used.income ?? 0, limit: 1000, added: true },
      { key: 'boost', label: 'Boost', rate: '3%', used: used.boost ?? 0, limit: 500, added: true },
    ],
  };
}

describe('what counts as secured', () => {
  test('savings-backed and asset-backed are collateralised', () => {
    expect(securedUsed(credit({ savings: 3000, asset: 2400 }))).toBe(5400);
    expect(unsecuredUsed(credit({ savings: 3000, asset: 2400 }))).toBe(0);
  });

  test('income-backed and boost are not', () => {
    expect(unsecuredUsed(credit({ income: 800, boost: 300 }))).toBe(1100);
    expect(securedUsed(credit({ income: 800, boost: 300 }))).toBe(0);
  });
});

describe('cycle shortfall', () => {
  test('a balance entirely against collateral clears on its own', () => {
    // The Home fixture: $5,400 drawn, all of it secured. Nothing to add, whatever the deposit is.
    expect(cycleShortfall(credit({ savings: 3000, asset: 2400 }), 0)).toBe(0);
  });

  test('an unsecured balance the deposit covers clears', () => {
    expect(cycleShortfall(credit({ income: 800 }), 2000)).toBe(0);
  });

  test('an unsecured balance the deposit does not cover leaves the gap', () => {
    expect(cycleShortfall(credit({ income: 1000, boost: 500 }), 1080)).toBe(420);
  });

  test('secured draw never adds to the gap, however large', () => {
    const heavy = credit({ savings: 3000, asset: 8000, income: 1000 });
    expect(cycleShortfall(heavy, 0)).toBe(1000);
  });

  test('a missing deposit estimate is treated as nothing arriving', () => {
    expect(cycleShortfall(credit({ boost: 500 }))).toBe(500);
  });

  test('a negative deposit estimate cannot manufacture a shortfall', () => {
    expect(cycleShortfall(credit({ income: 100 }), -5000)).toBe(100);
  });
});
