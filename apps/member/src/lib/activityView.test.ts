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
