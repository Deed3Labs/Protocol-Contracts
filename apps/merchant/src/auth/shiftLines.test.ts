import { describe, expect, test } from 'bun:test';
import { toShiftPerson, twelveHour } from './shiftLines';

/* What sign-in, the PIN screen and the lock say under a name, from the roster (reference: sign-in). */
const base = { id: 's1', name: 'Jen R.', role: 'counter' as const, pinSet: true };

describe('the lines under a name', () => {
  test('booked today: until when, and the span on the PIN and lock screens', () => {
    const noon = new Date(2026, 8, 26, 12, 0).getTime();
    const p = toShiftPerson({ ...base, today: { from: '08:00', to: '16:00' }, hoursSet: true }, noon);
    expect(p.hours).toBe('Until 4:00pm today');
    expect(p.span).toBe('8:00am – 4:00pm');
  });

  test('once the booked hours are over, they read as over, not "until"', () => {
    const late = new Date(2026, 8, 26, 22, 51).getTime();
    const p = toShiftPerson({ ...base, today: { from: '08:00', to: '16:00' }, hoursSet: true }, late);
    expect(p.hours).toBe('Hours ended 4:00pm today');
    expect(p.span).toBe('8:00am – 4:00pm');
  });

  test('hours on other days, none at all, and a first shift', () => {
    expect(toShiftPerson({ ...base, today: null, hoursSet: true }).hours).toBe('Not on today');
    expect(toShiftPerson({ ...base, today: null, hoursSet: false }).hours).toBe('No hours set');
    expect(toShiftPerson({ ...base, pinSet: false }).first).toBe(true);
  });

  test('an older server with no hours shows nothing rather than a guess', () => {
    const p = toShiftPerson(base);
    expect(p.hours).toBeUndefined();
    expect(p.span).toBeUndefined();
  });

  test('the shop’s own times, twelve-hour', () => {
    expect(twelveHour('00:30')).toBe('12:30am');
    expect(twelveHour('12:00')).toBe('12:00pm');
    expect(twelveHour('18:05')).toBe('6:05pm');
  });
});
