import { describe, expect, test } from 'bun:test';
import type { ShiftNow } from '@clear/merchant-contracts';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { STAFF_HOURS, STAFF_ID } from '../data/merchantApi/seed';
import { shiftClock } from '../home/model';
import { crewFromApi, hoursFromApi, hoursToApi, JEN_HOURS, usualLabel, weekFromApi } from './model';

// The clock reads the device's time zone: these run in the shop's, Pacific. 4:41pm on the reference Tuesday.
process.env.TZ = 'America/Los_Angeles';
const NOW = new Date('2026-09-22T16:41:00-07:00').getTime();
const jen: ShiftNow = { staffId: STAFF_ID.jen, name: 'Jen R.', role: 'counter', startedAt: '2026-09-22T15:04:00.000Z', onBreakSince: null, breakMinutes: 0, booked: { from: '08:00', to: '16:00' } };

describe('hours, between the API and the sheet', () => {
  test('the most common span is the usual one; the rest have their own', () => {
    const h = hoursFromApi(STAFF_HOURS[STAFF_ID.jen]!.thisWeek);
    expect(h).toEqual({ days: [true, true, true, true, true, false, false], start: 8, end: 16, own: { 3: [8, 12] } });
    expect(hoursToApi(h)).toEqual(STAFF_HOURS[STAFF_ID.jen]!.thisWeek!);
    expect(hoursToApi(JEN_HOURS).days).toHaveLength(5);
    expect(hoursToApi({ days: [true, false, false, false, false, false, false], start: 8.5, end: 13.75, own: {} })).toEqual({ days: [{ day: 0, open: { from: '08:30', to: '13:45' } }] });
    expect(hoursFromApi(null)).toEqual({ days: [false, false, false, false, false, false, false], start: 8, end: 16, own: {} });
  });

  test('usual hours, as the team reads them', () => {
    expect(usualLabel(STAFF_HOURS[STAFF_ID.jen]!.usual)).toBe('Mon–Fri, 8am–4pm');
    expect(usualLabel(STAFF_HOURS[STAFF_ID.mike]!.usual)).toBe('Tue off, varies');
    expect(usualLabel(null)).toBeUndefined();
  });
});

describe('the time clock', () => {
  test('on for, since, until, and a break due', () => {
    expect(shiftClock(jen, { minutes: 30, afterMinutes: 300 }, NOW)).toMatchObject({ onFor: '8h 37m', since: '8:04am', until: '4:00pm', hours: 8, done: 8, breakNote: 'break due' });
    expect(shiftClock(jen, null, NOW).left).toBeUndefined();
    const noon = new Date('2026-09-22T12:04:00-07:00').getTime();
    expect(shiftClock(jen, { minutes: 30, afterMinutes: 300 }, noon)).toMatchObject({ onFor: '4h 0m', left: '3h 56m', done: 4, breakNote: 'no break yet' });
  });

  test('breaks pause it', () => {
    const onBreak = { ...jen, breakMinutes: 15, onBreakSince: '2026-09-22T23:31:00.000Z' };
    const c = shiftClock(onBreak, null, NOW);
    expect(c.onFor).toBe('8h 12m');
    expect(c.onBreak).toEqual({ for: '10m', from: '4:31pm' });
    expect(c.breakNote).toBe('15m break taken');
  });

  test('not booked: no end, no blocks', () => {
    const c = shiftClock({ ...jen, booked: null }, null, NOW);
    expect(c.hours).toBe(0);
    expect(c.until).toBeUndefined();
    expect(c.left).toBeUndefined();
  });
});

describe('the Staff page from the mock', () => {
  test('the crew, the holder first, and the week', async () => {
    const { api } = createMockMerchantApi({ delayMs: 0 });
    const shifts = await api.shifts();
    expect(crewFromApi(shifts, STAFF_ID.mike, NOW).map((m) => [m.name, m.holds, m.until ?? null])).toEqual([
      ['Mike R.', true, null],
      ['Jen R.', false, '4:00pm'],
      ['Luis M.', false, '2:00pm'],
    ]);
    const week = weekFromApi(await api.staffWeek(), shifts, new Date(NOW));
    expect(week.label).toBe('Sep 21 – 27');
    expect(week.today).toBe(1);
    expect(week.now).toBeCloseTo(16 + 41 / 60);
    expect(week.booked[STAFF_ID.jen]![3]).toEqual([8, 12]);
    expect(week.unbooked).toEqual({ [STAFF_ID.mike]: 12 + 10 / 60 });
  });
});
