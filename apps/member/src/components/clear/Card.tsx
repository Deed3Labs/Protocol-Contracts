import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The card surface — design spec §2: 12px radius, 13px/15px padding, 0.5px border.
 *
 * Deliberately unfilled. In the reference the card background is the same color as
 * the page behind it; only the border groups it. That also matches this app's
 * standing rule that content sits on the page rather than in floating panels.
 *
 * `accent` turns the border violet — used on the Clear credit card once credit is
 * engaged (spec §3, rule 6).
 */
export default function Card({
  children,
  accent,
  className,
}: {
  children: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border-[0.5px] px-[15px] py-[13px]',
        accent ? 'border-tier-boost' : 'border-border',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Hairline rule inside a card, with the spec's 11px breathing room. Wraps the
 * content that sits below the rule, or renders as a bare divider with no children.
 */
export function CardRule({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-[11px] border-t-[0.5px] border-border pt-[11px]', className)}>{children}</div>
  );
}
