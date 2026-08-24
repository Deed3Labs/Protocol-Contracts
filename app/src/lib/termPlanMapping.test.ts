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

/*
 * The ELPA row is the one place a member watches a balance climb toward the thing they are saving
 * for, and it read a hardcoded "0 of 15,000" — the same for a member with nothing and a member
 * with fourteen thousand.
 */
describe('the ELPA row shows real progress', () => {
  const elpaIn = (data: ReturnType<typeof toTermPlans>) => data.plans.find((p) => p.id === 'elpa');

  test('reads the member’s actual credits', () => {
    const row = elpaIn(toTermPlans([], HOME_DAY_ONE.termPlans, { credits: 130, goal: 15_000 }));
    expect(row?.lockedNote).toBe('130 of 15,000 credits');
  });

  test('and not the hardcoded zero it used to show', () => {
    // Exact, not a substring: "130 of 15,000" contains "0 of 15,000".
    const row = elpaIn(toTermPlans([], HOME_DAY_ONE.termPlans, { credits: 130, goal: 15_000 }));
    expect(row?.lockedNote).not.toBe('0 of 15,000 credits');
  });

  test('unlocks when the goal is met', () => {
    // Leaving it greyed out would tell a member they cannot have the thing they just spent two
    // years qualifying for. The shelf treats a row as locked precisely when it carries a reason.
    const row = elpaIn(toTermPlans([], HOME_DAY_ONE.termPlans, { credits: 15_000, goal: 15_000 }));
    expect(row?.lockedNote).toBeUndefined();
  });

  test('stays locked one credit short', () => {
    const row = elpaIn(toTermPlans([], HOME_DAY_ONE.termPlans, { credits: 14_999, goal: 15_000 }));
    expect(row?.lockedNote).toBe('14,999 of 15,000 credits');
  });

  test('is left alone before credits have been read', () => {
    // Unread is not zero. Rewriting the row with a figure we do not have would be inventing one.
    const row = elpaIn(toTermPlans([], HOME_DAY_ONE.termPlans));
    expect(row?.lockedNote).toBeDefined();
  });
});

describe('the ground lease is not a term plan', () => {
  test('it is gone from the shelf entirely', () => {
    for (const data of [HOME_DAY_ONE.termPlans, toTermPlans([], HOME_DAY_ONE.termPlans)]) {
      expect(data.plans.some((p) => p.id === 'ground-lease')).toBe(false);
    }
  });

  test('and the rows around it did not shift', () => {
    // Removing it moved every index after it, and `LOCKED_PLANS[2]` silently became undefined in
    // a list that renders. The fixtures pick rows by id now.
    expect(HOME_DAY_ONE.termPlans.plans.every(Boolean)).toBe(true);
    expect(HOME_DAY_ONE.termPlans.plans.some((p) => p.id === 'elpa')).toBe(true);
  });
});
