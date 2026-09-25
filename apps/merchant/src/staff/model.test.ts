import { describe, expect, test } from 'bun:test';
import { cover, coverLine, daysLabel, gapLine, hoursTotal, JEN_FRIDAY_SHORT, JEN_HOURS, JEN_THIS_WEEK, OWNER_VIEW, ticks, weekHours } from './model';

const week = OWNER_VIEW.week;

describe('the week, as the Staff reference draws it', () => {
  test('finds the gaps nobody is booked for', () => {
    expect(coverLine(week, 0)).toEqual({ t: '4–6 open', cls: 'gap' });
    expect(coverLine(week, 2)).toEqual({ t: 'Covered', cls: 'ok' });
    expect(coverLine(week, 3)).toEqual({ t: '12–2 open', cls: 'gap' });
    expect(coverLine(week, 5)).toEqual({ t: 'Nobody booked', cls: 'gap' });
    expect(cover(week, 3).cov.map((s) => [s.left, s.width])).toEqual([[0, 40], [60, 40]]);
    expect(gapLine(week)).toBe('Nobody booked Saturday, and gaps on 3 days');
  });

  test('adds up the booked hours: 36, 22 and 8 make 66', () => {
    expect(Object.values(week.booked).map(weekHours)).toEqual([36, 22, 8]);
  });

  test('leaves out the tick under the now marker', () => {
    expect(ticks([8, 18], 0.427).map((t) => t.label)).toEqual(['8am', '10', '2', '4', '6pm']);
    expect(ticks([9, 14]).map((t) => t.label)).toEqual(['9am', '10', '11', '12', '1', '2pm']);
  });

  test('totals an hours sheet the way its footer says it', () => {
    expect([daysLabel(JEN_HOURS.days), hoursTotal(JEN_HOURS)]).toEqual(['Mon–Fri', 40]);
    expect([daysLabel(JEN_THIS_WEEK.days), hoursTotal(JEN_THIS_WEEK)]).toEqual(['Thu off', 32]);
    expect(hoursTotal(JEN_FRIDAY_SHORT)).toBe(36);
  });
});
