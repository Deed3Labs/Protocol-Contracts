import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Page headline — the balance block pattern from the reference screens, shared by
 * Savings and Earn: small label, one big figure, a sub-line, and a trailing slot
 * for actions or a second figure.
 *
 * Desktop puts the trailing slot on the same baseline as the figure; mobile drops
 * it below, full width, so buttons stay thumb-sized.
 */
export default function PageHeader({
  label,
  value,
  sub,
  trailing,
  trailingInline,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  trailing?: ReactNode;
  /**
   * Keep the trailing slot beside the figure on mobile too, instead of dropping
   * it below. For a compact second figure; a pair of buttons won't fit next to
   * the balance at 375px and should stay stacked.
   */
  trailingInline?: boolean;
}) {
  return (
    <div
      className={cn(
        'mb-4 flex gap-3 lg:mb-[18px] lg:flex-row lg:items-end lg:justify-between lg:gap-6',
        trailingInline ? 'items-end justify-between' : 'flex-col',
      )}
    >
      <div>
        <p className="mb-1 text-xs text-foreground-secondary">{label}</p>
        <p className="font-display mb-1 text-[32px] font-medium leading-none tracking-[-0.5px] lg:text-[38px] lg:tracking-[-0.8px]">
          {value}
        </p>
        {sub && <p className="text-xs text-foreground-secondary">{sub}</p>}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
