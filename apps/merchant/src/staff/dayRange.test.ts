import { describe, expect, test } from 'bun:test';
import { dayRange, type Week } from './model';

const week = (over: Partial<Week> = {}): Week => ({
  label: 'Sep 21 – 27',
  days: Array.from({ length: 7 }, (_, i) => ({ short: 'Mo', long: 'Monday', date: 21 + i, open: [9, 17] as [number, number] })),
  today: 5,
  now: 1.05,
  booked: { miesha: [null, null, null, null, null, [8, 16], null] },
  ...over,
});

describe('the day’s timeline', () => {
  test('open hours, widened for anyone booked before opening', () => {
    expect(dayRange(week(), 5)).toEqual([8, 17]);
    expect(dayRange(week(), 4)).toEqual([9, 17]);
  });

  test('today, someone on shift without a booking widens it to when they started', () => {
    expect(dayRange(week({ unbooked: { isaiah: 1.03 } }), 5)).toEqual([1, 17]);
    // Only today: an unbooked start isn't another day's.
    expect(dayRange(week({ unbooked: { isaiah: 1.03 } }), 4)).toEqual([9, 17]);
  });
});
