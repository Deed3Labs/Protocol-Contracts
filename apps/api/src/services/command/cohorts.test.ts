import { describe, expect, test } from 'bun:test';
import { DAY, type MemberRow } from '@clear/command-types';
import { cohortsOf } from './cohorts.js';

/*
 * Growth's Cohorts, live: invite weeks from Members' rows, the activations and first spends by week
 * since each invite, who is still active, how fast they activated and how they funded.
 */

// Wednesday 28 Oct 2026; its week starts Monday 26 Oct
const NOW = Date.UTC(2026, 9, 28, 12);
const MON_19 = Date.UTC(2026, 9, 19);
const MON_26 = Date.UTC(2026, 9, 26);
let id = 0;
const m = (o: Partial<MemberRow> & { invited: number }): MemberRow => ({
  id: ++id,
  no: '',
  first: null,
  last: null,
  batch: 1,
  joined: o.invited,
  city: '',
  src: 'Website',
  status: 'invited',
  poster: null,
  last_: o.invited,
  left: 90,
  quiet: false,
  ...o,
});

const rows: MemberRow[] = [
  // batch 1, invited Tuesday 20 Oct: one funded the same day by bank and spent on day 9, seen yesterday
  m({ invited: MON_19 + DAY, status: 'active', fund: 'Bank', activeAt: MON_19 + DAY + 3600_000, spentAt: MON_19 + 10 * DAY, last_: NOW - DAY }),
  // one funded with a direct deposit on day 5, not seen since
  m({ invited: MON_19 + DAY, status: 'active', fund: 'Deposit', activeAt: MON_19 + 6 * DAY, last_: MON_19 + 6 * DAY - 20 * DAY }),
  // one opened, not funded; one not opened
  m({ invited: MON_19 + 2 * DAY, status: 'opened', opened: MON_19 + 3 * DAY }),
  m({ invited: MON_19 + 2 * DAY }),
  // an account without an invite code, opened this week
  m({ invited: MON_26 + DAY, batch: 0, status: 'opened', opened: MON_26 + DAY }),
];

describe('cohorts', () => {
  const c = cohortsOf(rows, NOW);

  test('one row per invite week, Monday first, with the batches it came from', () => {
    expect(c.weeks.map((w) => [w.start, w.batches, w.inv])).toEqual([
      [MON_19, [1], 4],
      [MON_26, [0], 1],
    ]);
  });

  test('activated, opened, still active and spent, counted', () => {
    expect(c.weeks[0]).toMatchObject({ act: 2, open: 1, keep: 1, spent: 1 });
    expect(c.weeks[1]).toMatchObject({ act: 0, open: 1, keep: 0, spent: 0 });
  });

  test('by week since each person’s invite: both activated in week 1, the spend landed in week 2', () => {
    expect(c.weeks[0].actBy).toEqual([2, 2, 2, 2, 2, 2]);
    expect(c.weeks[0].spentBy).toEqual([0, 1, 1, 1, 1, 1]);
  });

  test('how fast, how they funded, and the median', () => {
    // same day and 4–7 days
    expect(c.tt).toEqual([1, 0, 1, 0, 0, 0]);
    expect(c.how).toEqual([
      ['Bank', 1, 1],
      ['$5', 0, 0],
      ['Deposit', 1, 0],
    ]);
    expect(c.medianDays).toBe(2.5);
  });

  test('nobody yet is an empty list, not an error', () => {
    expect(cohortsOf([], NOW)).toEqual({ weeks: [], tt: [0, 0, 0, 0, 0, 0], how: [['Bank', 0, 0], ['$5', 0, 0], ['Deposit', 0, 0]], medianDays: null });
  });
});
