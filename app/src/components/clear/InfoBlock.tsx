import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The tinted note that explains a trade-off just before someone commits to it —
 * what stays locked, what can be withdrawn, what it costs.
 *
 * `accent` for a caveat worth reading, `success` for what you gain, `neutral`
 * for context that's neither.
 */
export default function InfoBlock({
  tone = 'accent',
  children,
  className,
}: {
  tone?: 'accent' | 'success' | 'neutral';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    accent: 'bg-tier-boost/10 text-tier-boost-fg',
    success: 'bg-tier-savings/10 text-tier-savings-fg',
    neutral: 'bg-secondary text-foreground-secondary',
  };

  return (
    <div className={cn('rounded-lg px-3.5 py-2.5 text-xs leading-relaxed', tones[tone], className)}>
      {children}
    </div>
  );
}
