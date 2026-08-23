import { describe, expect, test } from 'bun:test';
import { toTermPlans } from '@/lib/creditMapping';
import { HOME_DAY_ONE } from '@/data/clearPlaceholder';
import type { CreditTermPlanRow } from '@/utils/apiClient';

const plan = (over: Partial<CreditTermPlanRow> = {}): CreditTermPlanRow => ({
  planId: 7,
  principalCents: 94_000,
  outstandingCents: 94_000,
  repaidCents: 0,
  installments: 4,
  installmentCents: 24_675,
  scheduleTotalCents: 98_700,
  openedAt: Math.floor(Date.UTC(2026, 5, 14) / 1000),
  rateBps: 200,
  merchantName: "Mike's Tire",
  closed: false,
  ...over,
});

describe('the term-plan shelf, from chain', () => {
  test('carries the figures the shelf quotes', () => {
    const [row] = toTermPlans([plan()], HOME_DAY_ONE.termPlans).plans;
    expect(row.name).toBe("Mike's Tire");
    expect(row.balance).toBe(940);
    expect(row.splitInto).toBe(4);
    expect(row.perCycle).toBeCloseTo(246.75, 2);
    expect(row.rate).toBe('2% / cycle');
    expect(row.ratePerCycle).toBeCloseTo(0.02, 4);
  });

  test('cycles left comes from what is still owed, not from the split', () => {
    // Half repaid is two cycles left of four, and the shelf must not keep saying four.
    const [row] = toTermPlans([plan({ outstandingCents: 47_000 })], HOME_DAY_ONE.termPlans).plans;
    expect(row.cyclesLeft).toBe(2);
  });

  test('a plan with no merchant name is still shown', () => {
    // A row labelled generically beats a row that silently disappears — the member owes it either
    // way, and a shelf that hides a debt is worse than one that names it poorly.
    const [row] = toTermPlans([plan({ merchantName: null })], HOME_DAY_ONE.termPlans).plans;
    expect(row.name).toBe('Term plan');
    expect(row.balance).toBe(940);
  });

  test('the locked products survive a real plan arriving', () => {
    // Partner credit and an ELPA are products nobody has unlocked yet, not fields that failed to
    // load. Dropping them because the chain returned one plan would delete the component's point.
    const lockedBefore = HOME_DAY_ONE.termPlans.plans.filter((p) => p.lockedNote).length;
    expect(lockedBefore).toBeGreaterThan(0);
    const after = toTermPlans([plan()], HOME_DAY_ONE.termPlans).plans.filter((p) => p.lockedNote);
    expect(after.length).toBe(lockedBefore);
  });

  test('no plans is a real answer, not a failed read', () => {
    // Day one for a direct arrival. The route answers 503 when it could not read the chain, so an
    // empty array here means a member with nothing owed.
    const result = toTermPlans([], HOME_DAY_ONE.termPlans);
    expect(result.plans.every((p) => p.lockedNote)).toBe(true);
  });

  test('a zero installment does not divide by zero', () => {
    const [row] = toTermPlans([plan({ installmentCents: 0 })], HOME_DAY_ONE.termPlans).plans;
    expect(row.cyclesLeft).toBeUndefined();
  });
});

/*
 * Day one's two arrivals. HomePage reverses its order on whether an active plan exists, so this is
 * the join that makes a counter arrival actually look like one.
 */
describe('day one leads with whichever one they are here for', () => {
  test('a counter member has an active plan for HomePage to lead with', () => {
    const { plans } = toTermPlans([plan()], HOME_DAY_ONE.termPlans);
    expect(plans.some((p) => !p.lockedNote && (p.balance ?? 0) > 0)).toBe(true);
  });

  test('a direct member has none, so saving leads', () => {
    const { plans } = toTermPlans([], HOME_DAY_ONE.termPlans);
    expect(plans.some((p) => !p.lockedNote && (p.balance ?? 0) > 0)).toBe(false);
  });
});
