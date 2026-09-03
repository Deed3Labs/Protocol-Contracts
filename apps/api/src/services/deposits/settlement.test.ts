import { describe, expect, test } from 'bun:test';
import { allocate, planSettlement, totalOutstanding, type Outstanding } from './settlement.js';

/*
 * This decides where a member's paycheck goes before they see any of it, so the cases that cost
 * someone real money are the ones covered: repayment order, a deposit that doesn't cover the debt,
 * and auto-save never running ahead of settlement.
 */

const clear: Outstanding = { boost: 0, income: 0, asset: 0, savings: 0 };

/** The Home fixture in cents: $3,000 savings-backed and $2,400 asset-backed drawn. */
const drawn: Outstanding = { boost: 0, income: 0, asset: 240_000, savings: 300_000 };

describe('repayment order', () => {
  test('clears the most expensive tier first', () => {
    const plan = planSettlement(100_000, { boost: 50_000, income: 40_000, asset: 30_000, savings: 20_000 });
    expect(plan.settlements).toEqual([
      { tier: 'boost', amountCents: 50_000 },
      { tier: 'income', amountCents: 40_000 },
      { tier: 'asset', amountCents: 10_000 },
    ]);
  });

  test('leaves the free tier for last', () => {
    // Exactly enough for everything except the free savings-backed balance.
    const plan = planSettlement(120_000, { boost: 50_000, income: 40_000, asset: 30_000, savings: 20_000 });
    expect(plan.outstandingAfter).toEqual({ boost: 0, income: 0, asset: 0, savings: 20_000 });
    expect(plan.remainingCents).toBe(0);
  });

  test('repaying is the inverse of drawing — cheapest tier is settled last', () => {
    const plan = planSettlement(300_000, drawn);
    expect(plan.settlements[0].tier).toBe('asset');
    expect(plan.settlements[1].tier).toBe('savings');
  });
});

describe('partial deposits', () => {
  test('a deposit smaller than the debt settles what it can', () => {
    const plan = planSettlement(100_000, drawn);
    expect(plan.settledCents).toBe(100_000);
    expect(plan.remainingCents).toBe(0);
    expect(totalOutstanding(plan.outstandingAfter)).toBe(440_000);
  });

  test('a deposit larger than the debt leaves the rest as cash', () => {
    const plan = planSettlement(600_000, drawn);
    expect(plan.settledCents).toBe(540_000);
    expect(plan.remainingCents).toBe(60_000);
    expect(totalOutstanding(plan.outstandingAfter)).toBe(0);
  });

  test('a deposit with nothing owed is entirely the member’s', () => {
    const plan = planSettlement(200_000, clear);
    expect(plan.settlements).toEqual([]);
    expect(plan.remainingCents).toBe(200_000);
  });

  test('never settles into the negative', () => {
    const plan = planSettlement(1_000_000, drawn);
    expect(Object.values(plan.outstandingAfter).every((v) => v >= 0)).toBe(true);
    expect(plan.settledCents).toBe(540_000);
  });
});

describe('auto-save allocation', () => {
  test('runs on the remainder, not the gross deposit', () => {
    // $2,000 in, $5,400 owed: everything settles and there is nothing left to save, even though a
    // $500 auto-save is configured. Saving at 0% while paying 3% would be the alternative.
    const plan = planSettlement(200_000, { boost: 0, income: 0, asset: 240_000, savings: 300_000 });
    const allocation = allocate({ remainingCents: plan.remainingCents, autoSaveCents: 50_000 });
    expect(allocation.toSavingsCents).toBe(0);
    expect(allocation.toCashCents).toBe(0);
  });

  test('saves the configured amount when the remainder covers it', () => {
    const plan = planSettlement(600_000, drawn);
    const allocation = allocate({ remainingCents: plan.remainingCents, autoSaveCents: 50_000 });
    expect(allocation.toSavingsCents).toBe(50_000);
    expect(allocation.toCashCents).toBe(10_000);
  });

  test('skips rather than overdraws when the remainder is short', () => {
    const allocation = allocate({ remainingCents: 30_000, autoSaveCents: 50_000 });
    expect(allocation.toSavingsCents).toBe(30_000);
    expect(allocation.toCashCents).toBe(0);
  });

  test('no auto-save configured leaves everything as cash', () => {
    const allocation = allocate({ remainingCents: 60_000 });
    expect(allocation).toEqual({ toSavingsCents: 0, toCashCents: 60_000 });
  });
});
