import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether an element's content is taller than the box it scrolls in.
 *
 * A list that reaches the bottom of its box needs no rule under its last row — the box's own edge is
 * already there, and a second line beside it reads as a mistake. One that stops short does need it,
 * so the space below is slack rather than more list. Watched rather than measured once, because both
 * the content and the box change size.
 */
export function useOverflows(ref: RefObject<HTMLElement | null>, deps: unknown[] = []): boolean {
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);

  return overflows;
}
