import { ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Stat {
  label: string;
  value: string;
  change?: string;
  changePositive?: boolean;
  icon?: LucideIcon;
}

/**
 * A single stat container divided by faint grid lines (gap-px over bg-border),
 * instead of N separate cards. One strategic highlight container, hairline-divided.
 */
export default function StatBar({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-border', className)}>
      <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          const negative = s.changePositive === false;
          return (
            <div key={s.label} className="bg-card p-4 lg:p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
                {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div className="mt-2 font-display text-2xl tracking-tight text-foreground tabular-nums">{s.value}</div>
              {s.change && (
                <div
                  className={cn(
                    'mt-1.5 inline-flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[11px] font-medium',
                    negative ? 'bg-destructive/10 text-destructive' : 'bg-secondary text-foreground',
                  )}
                >
                  {negative ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                  {s.change}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
