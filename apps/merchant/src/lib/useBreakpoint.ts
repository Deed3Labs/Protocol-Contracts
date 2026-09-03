import { useEffect, useState } from 'react';
import { breakpoint } from '@clear/tokens';

export type Layout = 'phone' | 'single' | 'two-column';

/**
 * Which of the three arrangements is in play.
 *
 * The layout itself is CSS — this is for the handful of places behaviour differs rather than
 * position, such as whether a panel opens inline or as a sheet. It never decides whether something
 * is *shown*: nothing is removed at any width.
 */
export function useLayout(): Layout {
  const read = (): Layout => {
    if (typeof window === 'undefined') return 'two-column';
    if (window.innerWidth < breakpoint.phone) return 'phone';
    if (window.innerWidth < breakpoint.twoColumn) return 'single';
    return 'two-column';
  };

  const [layout, setLayout] = useState<Layout>(read);

  useEffect(() => {
    const onResize = () => setLayout(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return layout;
}
