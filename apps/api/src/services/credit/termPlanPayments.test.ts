import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { installmentsCovered } from './termPlanPayments.js';
import { nextPayment } from '../chain/creditReader.js';

const U = 1_000_000n; // one dollar in ledger units
const HISTORY = readFileSync(new URL('./repaymentHistory.ts', import.meta.url), 'utf8');
const RECORDER = readFileSync(new URL('../chain/usdcRepaymentService.ts', import.meta.url), 'utf8');

// A $400 plan split in 4: $102 an installment, $408 over the schedule, nothing carried in.
const plan = { installments: 4, installmentAmount: 102n * U, scheduleTotal: 408n * U };

describe('next payment on a plan', () => {
  const base = {
    installments: 4n,
    installmentAmount: plan.installmentAmount,
    scheduleTotal: plan.scheduleTotal,
    scheduleStart: 1_000n,
    installmentLength: 100n,
  };

  test('before anything is due it is the first installment, due at the end of the first period', () => {
    expect(nextPayment({ ...base, owed: 400n * U, repaid: 0n, due: 0n, scheduledDue: 0n })).toEqual({ amount: 102n * U, dueAt: 1_100 });
  });

  test('behind by one, it is the one missed plus the next', () => {
    expect(nextPayment({ ...base, owed: 402n * U, repaid: 0n, due: 1n, scheduledDue: 102n * U })).toEqual({ amount: 204n * U, dueAt: 1_200 });
  });

  test('on the last installment it squares the whole schedule, capped at what is owed', () => {
    const r = nextPayment({ ...base, owed: 103n * U, repaid: 306n * U, due: 3n, scheduledDue: 306n * U });
    expect(r).toEqual({ amount: 102n * U, dueAt: 1_400 });
  });

  test('once every installment is due, all of it is due now', () => {
    expect(nextPayment({ ...base, owed: 50n * U, repaid: 358n * U, due: 4n, scheduledDue: 408n * U })).toEqual({ amount: 50n * U, dueAt: null });
  });

  test('paid ahead: the next installment not yet covered, and only what is left on it', () => {
    // $146 paid on a $400 schedule of four $102 installments: the first met, $58 left on the second.
    const r = nextPayment({ ...base, owed: 354n * U, repaid: 146n * U, due: 0n, scheduledDue: 0n });
    expect(r).toEqual({ amount: 58n * U, dueAt: 1_200 });
  });

  test('schedule fully paid with carry left: that carry, with the last installment', () => {
    expect(nextPayment({ ...base, owed: 1n * U, repaid: 408n * U, due: 1n, scheduledDue: 102n * U })).toEqual({ amount: 1n * U, dueAt: 1_400 });
  });

  test('a re-split floor is recovered, not ignored', () => {
    // $50 carried in as behind; one installment of the new schedule due.
    const r = nextPayment({ ...base, owed: 300n * U, repaid: 0n, due: 1n, scheduledDue: 50n * U + 102n * U });
    expect(r.amount).toBe(50n * U + 204n * U);
  });
});

describe('installments a payment covers', () => {
  const at = (repaid: bigint, due = 0n, scheduledDue = 0n, closed = false) =>
    installmentsCovered({ ...plan, repaid, due, scheduledDue, closed });

  test('a part payment counts toward the first', () => expect(at(40n * U)).toBe(1));
  test('two installments paid is 2 of 4', () => expect(at(204n * U)).toBe(2));
  test('never claims the last until the schedule is square', () => expect(at(407n * U, 4n, 408n * U)).toBe(3));
  test('paid off is every installment', () => expect(at(410n * U, 1n, 102n * U, true)).toBe(4));
});

describe('where plan payments are written and read', () => {
  test('the recorder reads PlanPaid from the receipt, with the same method as the card share', () => {
    expect(RECORDER).toMatch(/recordPlanPayments\(\{[\s\S]{0,200}method: fromSavings > 0n \|\| redeemedSavings\(receipt, wallet\) \? 'savings' : method/);
  });
  test('the card row keeps only what did not go to a plan', () => {
    expect(HISTORY).toMatch(/Number\(r\.total_cents\) - \(toPlans\.get/);
  });
});
