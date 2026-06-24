import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TimelineBill {
  id: string;
  name: string;
  dateLabel: string;
  amount: number;
  icon: LucideIcon;
}

/**
 * Chronological timeline of upcoming bills with a running cumulative outflow —
 * answers "what's leaving my account, when, and how much by then?".
 */
export default function BillTimeline({
  bills,
  className,
}: {
  bills: TimelineBill[];
  className?: string;
}) {
  const total = bills.reduce((s, b) => s + b.amount, 0);
  let running = 0;

  return (
    <div className={cn('rounded-xl border border-border bg-card p-5', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Bill timeline</span>
        <span className="text-xs text-muted-foreground">{bills.length} bills</span>
      </div>
      <div className="mt-1 font-display text-3xl tracking-tight text-foreground tabular-nums">
        ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">due over the next 30 days</div>

      <div className="mt-5">
        {bills.map((b, i) => {
          running += b.amount;
          const Icon = b.icon;
          const last = i === bills.length - 1;
          return (
            <div key={b.id} className="flex gap-3">
              <div className="flex flex-col items-center pt-1.5">
                <span className="h-3 w-3 shrink-0 rounded-lg border-2 border-card bg-foreground" />
                {!last && <span className="my-1 w-px flex-1 bg-border" />}
              </div>
              <div className={cn('flex flex-1 items-center gap-3', last ? '' : 'pb-4')}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.dateLabel}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-base tracking-tight text-foreground tabular-nums">
                    ${b.amount.toLocaleString()}
                  </div>
                  <div className="text-[10px] tabular-nums text-muted-foreground">
                    ${running.toLocaleString()} by then
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
