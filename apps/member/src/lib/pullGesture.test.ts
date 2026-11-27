import { describe, expect, test } from 'bun:test';
import { pullDistance } from '@/lib/pullGesture';

/**
 * A pull swallows the touch it is acting on, and a swallowed touchmove reaches whatever else was
 * following that finger as a pointercancel. So this rule decides more than the spinner: it decides
 * whether the card stack keeps its swipe, near the top of the page where both live.
 */
describe('a pull goes down more than it goes across', () => {
  test('a straight pull pulls, at half the distance the finger moved', () => {
    expect(pullDistance(0, 40)).toBe(20);
  });

  test('a pull that wanders sideways is still a pull', () => {
    expect(pullDistance(10, 60)).toBe(30);
  });

  test('a sideways swipe with a downward lean belongs to whatever it is on', () => {
    expect(pullDistance(70, 6)).toBe(0);
    expect(pullDistance(-70, 6)).toBe(0);
  });

  test('an upward drag is a scroll', () => {
    expect(pullDistance(0, -40)).toBe(0);
  });

  test('the indicator cannot be dragged down the whole screen', () => {
    expect(pullDistance(0, 4000)).toBe(104);
  });
});
