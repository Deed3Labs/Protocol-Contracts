import { ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Metric {
  label: string;
  value: number;
  change?: string;
  changePositive?: boolean;
  icon: LucideIcon;
}

const fmtUsd = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The metric row — Accounts only.
 *
 * Deliberately NOT the shared StatBar: that component is used by five pages, and rewriting it to
 * this flat treatment is what forced the previous flat-design attempt to be reverted. This is a
 * page-local component so Accounts can change without touching Pay, Borrow, Assurance or
 * Transactions.
 *
 * Columns are separated by 1px hairlines only — no boxes, no fills, no shadows.
 */
export default function MetricRow({
  metrics,
  loading,
  className,
}: {
  metrics: Metric[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 border-b border-border sm:grid-cols-2 lg:grid-cols-4',
        className,
      )}
    >
      {metrics.map(({ label, value, change, changePositive, icon: Icon }, i) => (
        <div
          key={label}
          className={cn(
            'flex flex-col gap-3 border-border py-6 pr-6',
            // hairlines between columns, and between stacked rows on narrow screens
            i > 0 && 'border-t sm:border-t-0',
            i % 2 === 1 && 'sm:border-l sm:pl-6',
            i % 2 === 0 && i > 0 && 'sm:border-t lg:border-t-0',
            'lg:border-t-0',
            i > 0 && 'lg:border-l lg:pl-6',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {label}
            </span>
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
          </div>

          <span className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
            {loading ? <span className="text-muted-foreground/40">—</span> : fmtUsd(value)}
          </span>

          {change && (
            <span
              className={cn(
                'inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
                changePositive
                  ? 'bg-positive/10 text-positive'
                  : 'bg-negative/10 text-negative',
              )}
            >
              {changePositive ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {change}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
