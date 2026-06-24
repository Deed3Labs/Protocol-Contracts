import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Compact metric card for the dashboard stat row. */
export default function StatCard({
  label,
  value,
  change,
  changePositive = true,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  change?: string;
  changePositive?: boolean;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-4', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-2 font-display text-2xl tracking-tight text-foreground tabular-nums">{value}</div>
      {change && (
        <div
          className={cn(
            'mt-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
            changePositive ? 'bg-secondary text-foreground' : 'bg-destructive/10 text-destructive',
          )}
        >
          {changePositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {change}
        </div>
      )}
    </div>
  );
}
