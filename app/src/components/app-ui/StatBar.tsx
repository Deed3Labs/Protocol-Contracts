import { useEffect, useRef } from 'react';
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PriceWheel } from '@/components/PriceWheel';

export interface Stat {
  /** Number → rolls/animates (green/red on change); string → rendered as-is (already formatted). */
  value: number | string;
  label: string;
  change?: string;
  changePositive?: boolean;
  icon?: LucideIcon;
}

const fmtUsd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A single stat value that rolls smoothly to its new figure (and briefly flashes green/red on the
 * direction of change) instead of snapping — the old brokerage "price wheel", reused. Tracking the
 * previous value here means background balance polls animate rather than flicker.
 */
function AnimatedStatValue({ value }: { value: number }) {
  const prevRef = useRef(value);
  useEffect(() => {
    prevRef.current = value;
  }, [value]);
  return (
    <PriceWheel
      value={value}
      previousValue={prevRef.current}
      formatter={fmtUsd}
      duration={600}
      className="font-display text-2xl tracking-tight text-foreground tabular-nums"
    />
  );
}

/**
 * A single stat container divided by faint grid lines (gap-px over bg-border),
 * instead of N separate cards. One strategic highlight container, hairline-divided.
 */
export default function StatBar({ stats, loading, className }: { stats: Stat[]; loading?: boolean; className?: string }) {
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
              <div className="mt-2 font-display text-2xl tracking-tight text-foreground tabular-nums">
                {loading ? (
                  <span className="text-muted-foreground">—</span>
                ) : typeof s.value === 'number' ? (
                  <AnimatedStatValue value={s.value} />
                ) : (
                  s.value
                )}
              </div>
              {s.change && (
                <div
                  className={cn(
                    'mt-1.5 inline-flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[11px] font-medium',
                    negative ? 'bg-negative/10 text-negative' : 'bg-positive/10 text-positive',
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
