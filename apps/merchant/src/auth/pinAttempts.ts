import { useCallback, useEffect, useState } from 'react';

/**
 * Three tries, then the tablet waits 30 seconds — as the sign-in reference says on screen.
 *
 * Kept on the tablet because it is about the person at the counter mistyping, and the message has
 * to say how many tries are left. The server has its own, coarser limit per shop, which is the
 * one that stops guessing; this one only paces a person.
 */
export const TRIES = 3;
const WAIT_MS = 30_000;

export function usePinAttempts() {
  const [misses, setMisses] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);

  useEffect(() => {
    if (!waitUntil) return;
    const t = window.setTimeout(() => {
      setWaitUntil(0);
      setMisses(0);
    }, Math.max(0, waitUntil - Date.now()));
    return () => window.clearTimeout(t);
  }, [waitUntil]);

  /** Record a wrong PIN and return what the screen says. */
  const miss = useCallback((): string => {
    const next = misses + 1;
    setMisses(next);
    if (next >= TRIES) {
      setWaitUntil(Date.now() + WAIT_MS);
      return 'That is not it. Try again in 30 seconds.';
    }
    const left = TRIES - next;
    return `That is not it. ${left} ${left === 1 ? 'try' : 'tries'} left.`;
  }, [misses]);

  const reset = useCallback(() => {
    setMisses(0);
    setWaitUntil(0);
  }, []);

  return { miss, reset, waiting: waitUntil > 0 };
}
