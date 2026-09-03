import { describe, expect, test } from 'bun:test';
import { projectReserveDate } from './reserveProjection.js';
import type { Milestone } from './clearModel';

const MILESTONES: Milestone[] = [
  { id: 'start', title: 'Start saving', credits: 1000 },
  { id: 'reserve', title: 'Reserve your home', credits: 12000 },
];

const JAN_2026 = new Date(2026, 0, 15);

describe('the reserve projection', () => {
  test('projects from real credits and real accrual', () => {
    // 6,000 credits, 500 a month, 12,000 to go: twelve months out.
    expect(projectReserveDate(6_000, 500, MILESTONES, JAN_2026)).toBe('Jan 2027');
  });

  test('says nothing rather than inventing a future for a stalled member', () => {
    // Earning nothing a month never arrives. Printing a date anyway is the page making one up.
    expect(projectReserveDate(6_000, 0, MILESTONES, JAN_2026)).toBeNull();
  });

  test('says nothing once the milestone is already passed', () => {
    expect(projectReserveDate(12_000, 500, MILESTONES, JAN_2026)).toBeNull();
  });

  test('refuses a horizon nobody can act on', () => {
    // A credit a month is technically on track for the year 3000. Admitting the projection is
    // useless beats printing it.
    expect(projectReserveDate(0, 1, MILESTONES, JAN_2026)).toBeNull();
  });

  test('says nothing when there is no such milestone to reach', () => {
    expect(projectReserveDate(0, 500, [MILESTONES[0]], JAN_2026)).toBeNull();
  });
});
