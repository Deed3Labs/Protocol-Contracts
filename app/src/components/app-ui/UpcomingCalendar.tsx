import { useState } from 'react';
import { TrendingUp, Calendar, Bell, DollarSign, Plus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface UpcomingItem {
  id: string;
  name: string;
  amount: number;
  day: number;
  direction: 'in' | 'out';
}

const weekDays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const headerIcons: LucideIcon[] = [TrendingUp, Calendar, Bell];
const formatAmount = (a: number) => (a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${Math.round(a)}`);
const fmtMoney = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Upcoming recurring bills/income calendar — the old portfolio UpcomingTransactions
 * layout (day cells with dot clusters + day totals), reskinned to neutral. A solid dot
 * is a bill, a hollow $ dot is income, "+" marks overflow. Hover or tap a day to see
 * the transactions and amounts scheduled for it.
 */
export default function UpcomingCalendar({
  items,
  className,
}: {
  items: UpcomingItem[];
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

  const upcoming = items.filter((i) => i.day >= currentDay);
  const totalOut = upcoming.filter((i) => i.direction === 'out').reduce((s, i) => s + i.amount, 0);

  const allDays: (number | null)[] = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-5', className)}>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Upcoming transactions</span>
        <div className="flex items-center gap-1">
          {headerIcons.map((Icon, i) => (
            <button key={i} type="button" className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      <p className="mb-4 font-display text-3xl tracking-tight text-foreground tabular-nums">
        ${totalOut.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>

      <div className="mb-2 grid grid-cols-7 gap-1">
        {weekDays.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-muted-foreground">{d}</div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-7 gap-1">
        {allDays.map((day, idx) => {
          if (day === null) return <div key={`p${idx}`} className="min-h-14" aria-hidden />;
          const dayItems = items.filter((i) => i.day === day);
          const isToday = day === currentDay;
          const isPast = day < currentDay;
          const dayOut = dayItems.filter((i) => i.direction === 'out').reduce((s, i) => s + i.amount, 0);
          const overflow = dayItems.length > 3;
          const shown = overflow ? dayItems.slice(0, 2) : dayItems.slice(0, 3);
          const hasItems = dayItems.length > 0;
          const isActive = activeDay === day && hasItems;
          return (
            <div
              key={day}
              role={hasItems ? 'button' : undefined}
              tabIndex={hasItems ? 0 : undefined}
              onMouseEnter={() => hasItems && setActiveDay(day)}
              onMouseLeave={() => setActiveDay((d) => (d === day ? null : d))}
              onFocus={() => hasItems && setActiveDay(day)}
              onBlur={() => setActiveDay((d) => (d === day ? null : d))}
              onClick={() => hasItems && setActiveDay((d) => (d === day ? null : day))}
              className={cn(
                'relative flex min-h-14 min-w-0 flex-col items-center justify-between rounded-[6px] border p-1 outline-none',
                isPast ? 'border-border/50 opacity-60' : 'border-border',
                isToday && 'bg-secondary/40 ring-1 ring-foreground/40',
                hasItems && 'cursor-pointer focus-visible:ring-1 focus-visible:ring-foreground/60',
              )}
            >
              <span className={cn('text-[10px] font-medium', isToday ? 'flex h-4 w-4 items-center justify-center rounded-lg bg-foreground text-[9px] text-background' : 'text-foreground')}>
                {day}
              </span>
              {hasItems ? (
                <div className="flex items-center -space-x-1">
                  {shown.map((it) => (
                    <span
                      key={it.id}
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-lg border border-card',
                        it.direction === 'in' ? 'bg-background ring-1 ring-foreground/50' : 'bg-foreground',
                      )}
                    >
                      {it.direction === 'in' && <DollarSign className="h-2 w-2 text-foreground" />}
                    </span>
                  ))}
                  {overflow && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-lg border border-card bg-secondary text-secondary-foreground">
                      <Plus className="h-2 w-2" />
                    </span>
                  )}
                </div>
              ) : (
                <span className="h-4" />
              )}
              <span className="w-full truncate text-center text-[9px] font-medium text-muted-foreground">
                {dayOut > 0 ? formatAmount(dayOut) : ' '}
              </span>

              {isActive && (
                <div
                  className="absolute bottom-full left-1/2 z-30 mb-1.5 w-48 -translate-x-1/2 rounded-lg border border-border bg-card p-2.5 text-left shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{monthName} {day}</div>
                  <div className="space-y-1">
                    {dayItems.map((it) => (
                      <div key={it.id} className="flex items-center justify-between gap-3">
                        <span className="truncate text-[11px] text-muted-foreground">{it.name}</span>
                        <span className={cn('shrink-0 text-[11px] font-medium tabular-nums', it.direction === 'in' ? 'text-positive' : 'text-foreground')}>
                          {it.direction === 'in' ? '+' : '−'}{fmtMoney(it.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">
          {monthName} {currentDay} – {daysInMonth}
        </span>
        <span className="text-xs text-muted-foreground">{upcoming.length} upcoming</span>
      </div>
    </div>
  );
}
