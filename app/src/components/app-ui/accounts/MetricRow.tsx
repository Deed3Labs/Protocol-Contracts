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
        // 2×2 on phones, a single row from lg. Never one metric per row — four stacked
        // full-width figures pushed everything below the fold on mobile.
        'grid grid-cols-2 border-b border-border lg:grid-cols-4',
        className,
      )}
    >
      {metrics.map(({ label, value, change, changePositive, icon: Icon }, i) => (
        <div
          key={label}
          className={cn(
            // Padding lives on the column, not the row, so the row's bottom hairline and the
            // dividers between columns stay full-bleed to the shell edges.
            'flex flex-col gap-2 border-border px-5 py-5 lg:gap-3 lg:px-8 lg:py-6',
            // 2×2: right-hand cells get a left rule, the bottom pair gets a top rule.
            i % 2 === 1 && 'border-l',
            i > 1 && 'border-t',
            // single row from lg: rules between every column, none above.
            'lg:border-t-0',
            i > 0 && 'lg:border-l',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {label}
            </span>
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
          </div>

          <span className="text-2xl font-light leading-none tracking-tight tabular-nums text-foreground lg:text-[2rem]">
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
