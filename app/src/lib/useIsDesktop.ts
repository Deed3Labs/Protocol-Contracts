import { useEffect, useState } from 'react';

/** Matches the `lg` breakpoint the layouts split on. */
const QUERY = '(min-width: 1024px)';

/**
 * Whether the viewport is at the desktop layout.
 *
 * For the handful of places where the two layouts differ in *how much* they
 * show — a list that's five rows wide-screen and three on a phone — rather than
 * how they look. Everything else should stay CSS: duplicating markup to change a
 * count is how two layouts drift apart.
 *
 * Reads synchronously on first render so a desktop page never paints the mobile
 * version first.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
