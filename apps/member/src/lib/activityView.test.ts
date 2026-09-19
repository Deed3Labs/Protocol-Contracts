import { describe, expect, test } from 'bun:test';
import { ACTIVITY_IN_USE } from '@/data/clearPlaceholder';
import { DEFAULT_FILTERS, categoryShares, filterRows, groupByDay, rowTag, sortRows } from './activityView';

const rows = ACTIVITY_IN_USE.rows;

describe('where it went', () => {
  test('shares are whole numbers that add to 100, the catch-all taking the rounding', () => {
    const shares = categoryShares(ACTIVITY_IN_USE.categories!, 1842);
    expect(shares.map((s) => [s.label, s.pct])).toEqual([
      ['Groceries', 22],
      ['Bills', 15],
      ['Fuel', 10],
      ['Everything else', 53],
    ]);
  });
});

describe('the list', () => {
  test('direction and paid-from narrow the rows', () => {
    expect(filterRows(rows, { ...DEFAULT_FILTERS, direction: 'in' }, '').every((r) => r.amount > 0)).toBe(true);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, paidFrom: 'savings' }, '').map((r) => r.name)).toEqual(['Equity credits vested']);
  });

  test('search matches a merchant or an amount', () => {
    expect(filterRows(rows, DEFAULT_FILTERS, 'shell').map((r) => r.name)).toEqual(['Shell']);
    expect(filterRows(rows, DEFAULT_FILTERS, '$118.44').map((r) => r.name)).toEqual(['Stater Bros']);
  });

  test('days are sections in the order the rows arrive', () => {
    expect(groupByDay(rows).map((g) => g.day)).toEqual(['Today · Oct 26', 'Yesterday · Oct 25', 'Fri · Oct 24']);
  });

  test('largest sorts by size whichever way the money moved', () => {
    expect(sortRows(rows, 'largest')[0].name).toBe('Payroll deposit');
  });

  test('the tag says what paid, or what the row was', () => {
    const byName = (name: string) => rowTag(rows.find((r) => r.name === name)!).label;
    expect(byName('Shell')).toBe('Asset-backed');
    expect(byName('Chipotle')).toBe('Cash account');
    expect(byName('Diego R.')).toBe('Sent · @diegor');
    expect(byName("Mike's Tire")).toBe('Term plan · 2 of 4');
  });
});

import { cardTransactionRow } from './activityMapping';
import { sourceTag } from './clearModel';

describe('a credit purchase that has been repaid says so', () => {
  const base = {
    id: 't', name: 'MIKES TIRES', at: '2026-09-17T23:41:03Z', amountCents: 17500, heldCents: 17500,
    reversed: false, mcc: '7538', city: null, state: null, cardToken: 'c',
    draws: [{ source: 'savings', amountCents: 17500 }],
  };

  test('fully repaid: the row reads "Credit · repaid"', () => {
    const row = cardTransactionRow({ ...base, creditCents: 17500, creditRepaidCents: 17500 });
    expect(row.creditRepaid).toBe('full');
    expect(row.paidFromLabel).toBe('Credit · repaid');
    expect(sourceTag(row).label).toBe('Credit · repaid');
  });

  test('part repaid, and not repaid', () => {
    expect(cardTransactionRow({ ...base, creditCents: 17500, creditRepaidCents: 500 }).paidFromLabel).toBe('Credit · part repaid');
    const owed = cardTransactionRow({ ...base, creditCents: 17500, creditRepaidCents: 0 });
    expect(owed.paidFromLabel).toBe('Credit');
    expect(owed.creditRepaid).toBeUndefined();
  });
});

import { mergedActivityRows, repaymentRow } from './activityMapping';
import { rowTag } from './activityView';

describe('repayments show in Activity, named by how they were paid', () => {
  const entries = [
    { id: 'repay:0xb2f1', at: '2026-09-19T00:00:07Z', amountCents: 2500, method: 'savings' as const, txHash: '0xb2f1b716' },
    { id: 'repay:grp', at: '2026-09-18T20:55:23Z', amountCents: 17500, method: 'bank' as const, txHash: null },
  ];

  test('each method is labelled', () => {
    expect(rowTag(repaymentRow(entries[0])).label).toBe('Repaid · Savings');
    expect(sourceTag(repaymentRow(entries[1])).label).toBe('Repaid · Bank deposit');
    expect(repaymentRow({ ...entries[0], method: 'auto' }).paidFromLabel).toBe('USDC · automatic');
    expect(repaymentRow({ ...entries[0], method: 'manual' }).paidFromLabel).toBe('USDC');
  });

  test('negative: it left whatever paid it', () => {
    expect(repaymentRow(entries[1]).amount).toBe(-175);
    expect(repaymentRow(entries[1]).kind).toBe('repayment');
  });

  test('the token transfer behind an on-chain repayment is folded in, not listed twice', () => {
    const transfer = {
      id: '0xwallet:0xb2f1b716', name: 'USDC transfer', category: 'Transfer', date: 'Sep 19', ts: Date.parse('2026-09-19T00:00:07Z'),
      amount: -25, status: 'completed', source: '0xwallet', internal: false, spendCategory: 'Misc',
    } as never;
    const rows = mergedActivityRows([transfer], [], undefined, entries);
    expect(rows.map((r) => r.name)).toEqual(['Credit repayment', 'Credit repayment']);
  });

  test('a plan payment is named for the plan and tagged with where the schedule stands', () => {
    const row = repaymentRow({
      ...entries[0], id: 'plan:0xab:3', method: 'manual', amountCents: 10200,
      plan: { planId: 3, name: "Mike's Tire", index: 2, count: 4 },
    });
    expect(row.name).toBe("Mike's Tire payment");
    expect(rowTag(row).label).toBe('Term plan · 2 of 4');
    expect(row.amount).toBe(-102);
  });
});
