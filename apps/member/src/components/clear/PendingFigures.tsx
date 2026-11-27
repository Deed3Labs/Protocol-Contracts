import type { ReactNode } from 'react';

/**
 * Marks a page as having nothing to show yet -- no remembered figures, and its first read still
 * out. Every figure inside (`.c-fig`) draws as a soft placeholder the same size as the number it
 * stands for, so nothing moves when the number lands. Never used once figures exist: from then on
 * they update in place.
 *
 * `display: contents`, so it adds no box of its own to the layout it wraps.
 */
export default function PendingFigures({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <div className="contents" data-pending={pending ? '' : undefined} aria-busy={pending || undefined}>
      {children}
    </div>
  );
}
