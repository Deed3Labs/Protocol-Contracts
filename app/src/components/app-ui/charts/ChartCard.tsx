import type { ReactNode } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChartCardProps {
  /** Eyebrow label, e.g. "Total balance". */
  label: string;
  /** Hero figure — the takeaway, e.g. "$41,016.67". */
  value?: string;
  /** Comparison delta, e.g. "4.2% over 6 months". */
  delta?: { text: string; positive?: boolean };
  /** Secondary insight, e.g. "$416 under budget". */
  insight?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Insight-led chart container. Leads with the takeaway (value + delta + insight)
 * so the chart answers a question rather than just decorating.
 */
export default function ChartCard({
  label,
  value,
  delta,
  insight,
  action,
  children,
  className,
}: ChartCardProps) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          {value && (
            <div className="mt-1 font-display text-3xl tracking-tight text-foreground tabular-nums">
              {value}
            </div>
          )}
          {(delta || insight) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              {delta && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 font-medium',
                    delta.positive ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {delta.positive ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )}
                  {delta.text}
                </span>
              )}
              {insight && <span className="text-muted-foreground">{insight}</span>}
            </div>
          )}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}
