import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SettingRow {
  label: string;
  /** Current value, shown muted beside the chevron. Omit for rows that just navigate. */
  value?: ReactNode;
  /** Destructive or de-emphasised, e.g. "Close account & withdraw". */
  quiet?: boolean;
  onSelect?: () => void;
}

/**
 * Settings rows — label left, current value and a chevron right.
 *
 * The value is the point: someone opening settings is usually checking what
 * something is set to, not changing it. Showing it inline answers most visits
 * without anyone having to open the row.
 */
export default function SettingRows({ rows, className }: { rows: SettingRow[]; className?: string }) {
  return (
    <div className={className}>
      {rows.map((row, i) => (
        <button
          key={row.label}
          type="button"
          onClick={row.onSelect}
          className={cn(
            'flex w-full items-center justify-between gap-3 py-2.5 text-left text-[13px] transition-colors',
            i < rows.length - 1 && 'border-b-[0.5px] border-border',
            row.quiet && 'text-foreground-secondary',
          )}
        >
          <span className="min-w-0 truncate">{row.label}</span>
          <span className="flex shrink-0 items-center gap-2">
            {row.value && <span className="text-xs text-muted-foreground">{row.value}</span>}
            <ChevronRight className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.75} />
          </span>
        </button>
      ))}
    </div>
  );
}
