import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { splitBlockedReason, toTermPlans } from './creditMapping';
import { HOME_DAY_ONE } from '@/data/clearPlaceholder';
import type { CreditTermPlanRow } from '@/utils/apiClient';

const row = (over: Partial<CreditTermPlanRow> = {}): CreditTermPlanRow => ({
  planId: 4, principalCents: 10_000, outstandingCents: 10_000, repaidCents: 0, installments: 4,
  installmentCents: 2_550, scheduleTotalCents: 10_200, openedAt: 1_790_000_000, rateBps: 200,
  merchantName: null, closed: false, owedCents: 10_000, arrearsCents: 0, installmentsDue: 0,
  nextPaymentCents: 2_550, nextDueAt: 1_792_592_000, defaultsAt: null, splitChangesLeft: 3, nextSplitAt: null,
  ...over,
});

describe('why a split cannot change, in the order the contract checks', () => {
  test('behind comes first', () => {
    expect(splitBlockedReason(row({ arrearsCents: 2_550, splitChangesLeft: 0 }))).toMatch(/^Catch up first/);
  });
  test('three re-splits is the most', () => {
    expect(splitBlockedReason(row({ splitChangesLeft: 0 }))).toMatch(/three times/);
  });
  test('once a cycle, with the date it opens again', () => {
    expect(splitBlockedReason(row({ nextSplitAt: 2_000_000_000 }), 1_999_000_000)).toMatch(/^Once a cycle\. You can change it again on /);
  });
  test('nothing in the way', () => {
    expect(splitBlockedReason(row({ nextSplitAt: 1_000 }), 2_000)).toBeUndefined();
  });
});

describe('the shelf', () => {
  test('a plan behind carries the date it defaults', () => {
    const [plan] = toTermPlans([row({ arrearsCents: 2_550, defaultsAt: 1_795_000_000 })], HOME_DAY_ONE.termPlans).plans;
    expect(plan.defaultsOn).toBeTruthy();
    expect(plan.behind).toBe(25.5);
  });
  test('a default pauses term plans, with what is left to pay back', () => {
    const shelf = toTermPlans([], HOME_DAY_ONE.termPlans, undefined, {
      limitCents: 0, usedCents: 0, availableCents: 0, carryOwedCents: 0,
      suspended: true, writtenOffCents: 10_000, recoveredCents: 2_500,
    });
    expect(shelf.paused).toEqual({ toPayBack: 75 });
  });
  test('not paused, no pause', () => {
    expect(toTermPlans([], HOME_DAY_ONE.termPlans, undefined, null).paused).toBeUndefined();
  });
});

describe('paying from savings and paying back', () => {
  const calls = readFileSync(new URL('./sendCalls.ts', import.meta.url), 'utf8');
  test('savings are redeemed one-for-one then paid to the plan, in one batch', () => {
    expect(calls).toMatch(/export async function scPayPlanFromSavings[\s\S]{0,900}functionName: 'redeem'[\s\S]{0,300}functionName: 'approve', args: \[c\.stableCredit, args\.units\][\s\S]{0,200}functionName: 'payPlan'/);
  });
  test('paying back the rest reinstates in the same tap', () => {
    expect(calls).toMatch(/functionName: 'repayWrittenOff'[\s\S]{0,120}\.\.\.\(args\.clearsIt[\s\S]{0,160}functionName: 'reinstate'/);
  });
});
