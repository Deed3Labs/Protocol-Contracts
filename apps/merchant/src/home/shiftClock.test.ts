import { describe, expect, test } from 'bun:test';
import type { ShiftNow } from '@clear/merchant-contracts';
import { shiftClock } from './model';

// Local times on one day, as the tablet sees them.
const at = (h: number, m = 0) => new Date(2026, 8, 26, h, m).getTime();
const shift = (startedAt: number, booked: ShiftNow['booked'] = { from: '08:00', to: '16:00' }): ShiftNow => ({
  staffId: 'stf_jen',
  name: 'Jen R.',
  role: 'counter',
  startedAt: new Date(startedAt).toISOString(),
  onBreakSince: null,
  breakMinutes: 0,
  booked,
});

describe('the time clock against the booked hours', () => {
  test('inside the booking: until, what is left, the bar of its hours', () => {
    const c = shiftClock(shift(at(8, 4)), null, at(12, 16));
    expect(c).toMatchObject({ onFor: '4h 12m', since: '8:04am', until: '4:00pm', left: '3h 44m', hours: 8 });
    expect(c.over).toBeUndefined();
    expect(c.done).toBeCloseTo(4.2, 5);
  });

  test('worked past the booked end: how long over, the bar full', () => {
    const c = shiftClock(shift(at(8)), null, at(17, 12));
    expect(c).toMatchObject({ until: '4:00pm', over: '1h 12m', hours: 8, done: 8 });
    expect(c.left).toBeUndefined();
  });

  test('clocked on after the booking ended: outside it, no until, no bar', () => {
    const c = shiftClock(shift(at(22, 17)), null, at(22, 51));
    expect(c).toMatchObject({ onFor: '34m', since: '10:17pm', outside: '8:00am–4:00pm', hours: 0 });
    expect(c.until).toBeUndefined();
    expect(c.left).toBeUndefined();
    expect(c.over).toBeUndefined();
  });

  test('not booked today: none of it', () => {
    const c = shiftClock(shift(at(9), null), null, at(10));
    expect(c).toMatchObject({ onFor: '1h 0m', hours: 0 });
    expect(c.until ?? c.outside ?? c.over).toBeUndefined();
  });
});
