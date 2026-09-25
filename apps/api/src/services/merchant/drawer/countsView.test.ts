import { describe, expect, test } from 'bun:test';
import { type CountRow, countsView } from './countsView.js';

const row = (patch: Partial<CountRow>): CountRow => ({
  id: 'cnt_1',
  counter: 'stf_jen',
  method: 'total',
  notes: null,
  total_cents: 20800,
  second: false,
  saved_at: '2026-09-22T17:50:00-07:00',
  ...patch,
});

const never = () => {
  throw new Error('read the expected total before the counts were all in');
};

describe('blind counts', () => {
  test('nothing counted', () => {
    expect(countsView({ live: [], viewer: 'stf_jen', twoCounts: true, expectedCents: never })).toEqual({ state: 'awaiting_first' });
  });

  test('the first counter sees only their own count, and never the expected total', () => {
    const v = countsView({ live: [row({})], viewer: 'stf_jen', twoCounts: true, expectedCents: never });
    expect(v.state).toBe('awaiting_second');
    expect(v).toMatchObject({ mine: { counter: 'stf_jen', totalCents: 20800 } });
    expect(JSON.stringify(v)).not.toContain('expected');
  });

  test("the second counter sees nothing of the first count's figure", () => {
    const v = countsView({ live: [row({})], viewer: 'stf_luis', twoCounts: true, expectedCents: never });
    expect(v).toEqual({ state: 'awaiting_second', mine: null });
    expect(JSON.stringify(v)).not.toContain('20800');
  });

  test('both in: both figures, the expected total and the difference', () => {
    const v = countsView({
      live: [row({}), row({ id: 'cnt_2', counter: 'stf_luis', second: true })],
      viewer: 'stf_luis',
      twoCounts: true,
      expectedCents: () => 21179,
    });
    expect(v).toMatchObject({ state: 'compared', expectedCents: 21179, differenceCents: -379, countsAgree: true, signoffNeeded: true });
  });

  test('counts that disagree are counted again before anyone signs', () => {
    const v = countsView({
      live: [row({}), row({ id: 'cnt_2', counter: 'stf_luis', second: true, total_cents: 21000 })],
      viewer: 'stf_jen',
      twoCounts: true,
      expectedCents: () => 21179,
    });
    expect(v).toMatchObject({ state: 'compared', countsAgree: false, signoffNeeded: false });
  });

  test('with two counts off, one count is compared straight away', () => {
    const v = countsView({ live: [row({ total_cents: 21179 })], viewer: 'stf_jen', twoCounts: false, expectedCents: () => 21179 });
    expect(v).toMatchObject({ state: 'compared', differenceCents: 0, signoffNeeded: false });
  });
});
