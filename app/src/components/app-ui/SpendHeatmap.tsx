import { useState } from 'react';
import { TrendingDown, Calendar, Sparkles, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const weekDays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const headerIcons: LucideIcon[] = [TrendingDown, Calendar, Sparkles];

const formatAmount = (amount: number): string => {
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}k`;
  return amount > 0 ? `$${Math.round(amount)}` : '-';
};
const fmtMoney = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const getIntensity = (amount: number, max: number) => (amount <= 0 || max <= 0 ? 0 : Math.min(amount / max, 1));

export interface SpendDetail {
  category: string;
  amount: number;
}

/**
 * Spend-intensity calendar — the old portfolio SpendTracker layout (day + amount
 * per cell, Less/More legend), reskinned to neutral / Space Grotesk. Hover or tap a
 * day to see that day's spend broken down by category.
 */
export default function SpendHeatmap({
  spendingByDay,
  detailByDay,
  className,
}: {
  spendingByDay: Record<number, number>;
  detailByDay?: Record<number, SpendDetail[]>;
  className?: string;
}) {
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const currentDay = today.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();
  const monthName = today.toLocaleDateString('en-US', { month: 'long' });

  const dayValues = Object.values(spendingByDay).filter((v) => v > 0);
  const maxDaySpend = dayValues.length ? Math.max(...dayValues, 1) : 1;
  const totalSpent = dayValues.reduce((s, v) => s + v, 0);

  const allDays: (number | null)[] = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Anchor the tooltip to the cell edge on outer columns so it stays within the card (a centered
  // tooltip on the leftmost column slid under the fixed sidebar).
  const tipPos = (day: number) => {
    const col = (startDow + day - 1) % 7;
    if (col <= 1) return 'left-0';
    if (col >= 5) return 'right-0';
    return 'left-1/2 -translate-x-1/2';
  };

  return (
    <div className={cn('flex flex-col rounded-xl border border-border p-5', className)}>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Spend this month</span>
        <div className="flex items-center gap-1">
          {headerIcons.map((Icon, i) => (
            <button key={i} type="button" className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      <p className="mb-4 font-display text-3xl tracking-tight text-foreground tabular-nums">
        ${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>

      <div className="mb-2 grid grid-cols-7 gap-1">
        {weekDays.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-muted-foreground">{d}</div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-7 gap-1">
        {allDays.map((day, idx) => {
          if (day === null) return <div key={`p${idx}`} className="min-h-14" aria-hidden />;
          const amount = spendingByDay[day] ?? 0;
          const isPast = day <= currentDay;
          const isToday = day === currentDay;
          const intensity = getIntensity(amount, maxDaySpend);
          const inverted = isPast && intensity > 0.5;
          const hasSpend = amount > 0;
          const detail = detailByDay?.[day] ?? [];
          const isActive = activeDay === day && hasSpend;
          return (
            <div
              key={day}
              role={hasSpend ? 'button' : undefined}
              tabIndex={hasSpend ? 0 : undefined}
              onMouseEnter={() => hasSpend && setActiveDay(day)}
              onMouseLeave={() => setActiveDay((d) => (d === day ? null : d))}
              onFocus={() => hasSpend && setActiveDay(day)}
              onBlur={() => setActiveDay((d) => (d === day ? null : d))}
              onClick={() => hasSpend && setActiveDay((d) => (d === day ? null : day))}
              className={cn(
                'relative flex min-h-14 min-w-0 flex-col items-start justify-between rounded-[6px] border p-1.5 outline-none',
                isPast ? 'border-border' : 'border-border/50',
                isToday && 'ring-1 ring-foreground/40',
                hasSpend && 'cursor-pointer focus-visible:ring-1 focus-visible:ring-foreground/60',
              )}
            >
              <div className="pointer-events-none absolute inset-0 rounded-[6px] bg-foreground" style={{ opacity: isPast ? intensity : 0 }} aria-hidden />
              <span className={cn('relative z-10 text-xs font-medium', inverted ? 'text-background' : isPast ? 'text-foreground' : 'text-muted-foreground')}>{day}</span>
              <span className={cn('relative z-10 w-full truncate text-[10px] font-medium', inverted ? 'text-background/90' : 'text-muted-foreground')}>
                {isPast ? formatAmount(amount) : '-'}
              </span>

              {isActive && (
                <div
                  className={cn('absolute bottom-full z-50 mb-1.5 w-44 rounded-lg border border-border bg-card p-2.5 text-left shadow-xl', tipPos(day))}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-border pb-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{monthName} {day}</span>
                    <span className="text-[11px] font-semibold tabular-nums text-foreground">{fmtMoney(amount)}</span>
                  </div>
                  {detail.length > 0 ? (
                    <div className="space-y-1">
                      {detail.map((c) => (
                        <div key={c.category} className="flex items-center justify-between gap-3">
                          <span className="truncate text-[11px] text-muted-foreground">{c.category}</span>
                          <span className="shrink-0 text-[11px] tabular-nums text-foreground">{fmtMoney(c.amount)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">Spent {fmtMoney(amount)}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">{monthName} 1 – {currentDay}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Less</span>
          <div className="flex gap-0.5">
            {[0.2, 0.4, 0.6, 0.8, 1].map((o, i) => (
              <div key={i} className="h-3 w-3 rounded bg-foreground" style={{ opacity: o }} />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">More</span>
        </div>
      </div>
    </div>
  );
}
