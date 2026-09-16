/** Clamp so the indicator can't be dragged down the whole screen. */
const MAX_PULL = 104;
/** The drag feels weighted rather than 1:1 with the finger. */
const RESISTANCE = 0.5;

/**
 * How far this gesture has pulled — 0 when it is not a pull at all.
 *
 * A pull goes down more than it goes across. Judging it on the vertical distance alone swallowed
 * sideways gestures that leaned a little downward, and a swallowed touchmove arrives at whatever
 * was handling the swipe as a pointercancel: the card stack lost its drag halfway through, every
 * time, near the top of the page where both gestures live.
 */
export function pullDistance(dx: number, dy: number): number {
  if (dy <= 0 || Math.abs(dx) > dy) return 0;
  return Math.min(MAX_PULL, dy * RESISTANCE);
}
