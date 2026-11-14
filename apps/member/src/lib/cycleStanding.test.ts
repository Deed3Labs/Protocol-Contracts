import { describe, expect, test } from 'bun:test';
import { boostCapLine, standingNotice, type CycleStanding } from './cycleStanding';

const good: CycleStanding = {
  cleanStreak: 2,
  missedInRow: 0,
  cureNoticeAt: null,
  defaultFrom: null,
  unsecuredExcessCents: 0,
  boostCapCents: 50_000,
  boostCapEarned: false,
  boostEarnedCapCents: 75_000,
  boostCleanCycles: 6,
};

describe('cycle standing, in words (section 12.3-12.5)', () => {
  test('good standing shows no banner', () => {
    expect(standingNotice(good)).toBeNull();
    expect(standingNotice(null)).toBeNull();
  });

  test('a missed cycle halves the limit, and an excess is never taken from Savings', () => {
    const n = standingNotice({ ...good, missedInRow: 1, unsecuredExcessCents: 12_500 })!;
    expect(n.tone).toBe('warn');
    expect(n.body).toContain('halved');
    expect(n.body).toContain('$125');
    expect(n.body).toContain('never your Savings');
  });

  test('a cure notice gives the date default can begin', () => {
    const n = standingNotice({ ...good, missedInRow: 2, cureNoticeAt: 1_800_000_000, defaultFrom: 1_800_000_000 + 15 * 86_400 })!;
    expect(n.tone).toBe('alert');
    expect(n.title).toBe('Cure notice: two cycles missed');
    expect(n.body).toContain('to avoid default');
  });

  test('the Boost cap: $500, rising to $750 once earned', () => {
    expect(boostCapLine(good)).toBe('Boost up to $500 · rises to $750 after 6 clean cycles with savings deposits (2 so far)');
    expect(boostCapLine({ ...good, boostCapCents: 75_000, boostCapEarned: true })).toBe('Boost up to $750');
    expect(boostCapLine({ ...good, boostCapCents: null })).toBeNull();
  });
});
