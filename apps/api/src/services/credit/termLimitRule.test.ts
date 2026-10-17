import { describe, expect, test } from 'bun:test';
import { CEILING_CENTS, STARTER_CENTS, termLimitTarget, type TermLimitInput } from './termLimitRule.js';

const member = (over: Partial<TermLimitInput> = {}): TermLimitInput => ({
  verified: true,
  suspended: false,
  defaulted: false,
  inArrears: false,
  currentCents: 0,
  cleanInstallments: 0,
  monthlyDepositCents: 0,
  ...over,
});

describe('term limit rule', () => {
  test('a newly verified member gets the $500 starter', () => {
    expect(termLimitTarget(member())).toEqual({ targetCents: STARTER_CENTS, reason: 'starter' });
    expect(STARTER_CENTS).toBe(50_000);
  });

  test('an unverified member gets nothing', () => {
    expect(termLimitTarget(member({ verified: false }))).toBeNull();
  });

  test('three clean installments add $250 when income backs it', () => {
    // $2,000 a month in deposits: the income cap is $1,000, so $750 fits under it.
    const raised = termLimitTarget(member({ currentCents: 50_000, cleanInstallments: 3, monthlyDepositCents: 200_000 }));
    expect(raised?.targetCents).toBe(75_000);
  });

  test('income caps growth, but never below the starter', () => {
    // $1,200 a month: cap $600, so six clean installments ($1,000 earned) stop at $600.
    const capped = termLimitTarget(member({ currentCents: 50_000, cleanInstallments: 6, monthlyDepositCents: 120_000 }));
    expect(capped).toEqual({ targetCents: 60_000, reason: '6 clean installments, capped by income' });
  });

  test('no income keeps a clean member at $500', () => {
    expect(termLimitTarget(member({ currentCents: 50_000, cleanInstallments: 9 }))).toBeNull();
    expect(termLimitTarget(member({ cleanInstallments: 9 }))?.targetCents).toBe(STARTER_CENTS);
  });

  test('two clean installments are not yet a step', () => {
    expect(termLimitTarget(member({ currentCents: 50_000, cleanInstallments: 2, monthlyDepositCents: 1_000_000 }))).toBeNull();
  });

  test('never lowers a limit an operator set higher', () => {
    expect(termLimitTarget(member({ currentCents: 300_000, cleanInstallments: 3, monthlyDepositCents: 200_000 }))).toBeNull();
    expect(termLimitTarget(member({ currentCents: 75_000, cleanInstallments: 3, monthlyDepositCents: 200_000 }))).toBeNull();
  });

  test('a change under a dollar is not sent', () => {
    expect(termLimitTarget(member({ currentCents: 49_950 }))).toBeNull();
    expect(termLimitTarget(member({ currentCents: 49_900 }))?.targetCents).toBe(STARTER_CENTS);
  });

  test('suspended, defaulted and late members are left alone', () => {
    expect(termLimitTarget(member({ suspended: true }))).toBeNull();
    expect(termLimitTarget(member({ defaulted: true }))).toBeNull();
    expect(termLimitTarget(member({ inArrears: true, currentCents: 50_000, cleanInstallments: 30, monthlyDepositCents: 1_000_000 }))).toBeNull();
  });

  test('stops at the $5,000 ceiling', () => {
    const top = termLimitTarget(member({ currentCents: 400_000, cleanInstallments: 300, monthlyDepositCents: 10_000_000 }));
    expect(top).toEqual({ targetCents: CEILING_CENTS, reason: '300 clean installments, at the ceiling' });
    expect(termLimitTarget(member({ currentCents: CEILING_CENTS, cleanInstallments: 300, monthlyDepositCents: 10_000_000 }))).toBeNull();
  });
});
