import { describe, expect, test } from 'bun:test';
import { isAssuranceActive, LADDER_SLIVER, ladderSteps } from './clearModel.js';
import { SAVINGS_DAY_ONE } from '../data/clearPlaceholder.js';

const items = SAVINGS_DAY_ONE.assurance;

describe('the home-path ladder', () => {
  test('is the five protections, cheapest first', () => {
    expect(ladderSteps(items, 0).map((s) => s.item.unlocksAt)).toEqual([0, 1500, 4000, 8000, 15000]);
  });

  test('never has more than one next step', () => {
    for (const credits of [0, 1, 1499, 1500, 3200, 7999, 8000, 14999, 15000, 20000]) {
      expect(ladderSteps(items, credits).filter((s) => s.state === 'next').length).toBeLessThanOrEqual(1);
    }
  });

  test('a step is unlocked exactly when its protection chip reads On', () => {
    for (const credits of [0, 1500, 3200, 8000, 15000]) {
      for (const step of ladderSteps(items, credits)) {
        expect(step.state === 'got').toBe(isAssuranceActive(step.item, credits));
      }
    }
  });

  test('day one: cycle assurance is on and home repair shows a sliver', () => {
    const [cycle, repair] = ladderSteps(items, 0);
    expect(cycle.state).toBe('got');
    expect(repair.state).toBe('next');
    expect(repair.fill).toBe(LADDER_SLIVER);
  });

  test('the next step fills from the previous threshold to its own', () => {
    const next = ladderSteps(items, 3200).find((s) => s.state === 'next');
    expect(next?.item.unlocksAt).toBe(4000);
    expect(next?.fill).toBeCloseTo(0.68);
  });

  test('at 15,000 the path is complete: every step unlocked, none next', () => {
    const steps = ladderSteps(items, 15000);
    expect(steps.every((s) => s.state === 'got')).toBe(true);
  });
});
