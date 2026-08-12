import type { ReactNode } from 'react';

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
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 lg:mb-[18px] lg:flex-row lg:items-end lg:justify-between lg:gap-6">
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
