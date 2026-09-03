import { describe, expect, it } from 'bun:test';
import { formatCalendarDate, parseCalendarDate } from './dates';

describe('a payout date is a calendar day, not an instant', () => {
  it('does not slip a day west of Greenwich', () => {
    // The bug this exists to prevent: `new Date('2026-12-14')` is UTC midnight, which renders as
    // Dec 13 in every American timezone.
    expect(formatCalendarDate('2026-12-14')).toBe('Dec 14');
    expect(formatCalendarDate('2026-01-01')).toBe('Jan 1');
  });

  it('parses to local midnight on the day named', () => {
    const d = parseCalendarDate('2026-12-14');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(14);
    expect(d.getHours()).toBe(0);
  });

  it('ignores a time component if one is supplied', () => {
    expect(formatCalendarDate('2026-12-14T23:59:59Z')).toBe('Dec 14');
  });
});
