import { DollarSign, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface UpcomingItem {
  id: string;
  name: string;
  amount: number;
  day: number;
  direction: 'in' | 'out';
}

const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const fmt = (a: number) => (a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${Math.round(a)}`);

/**
 * Upcoming recurring bills/income calendar (restyle of the old portfolio
 * UpcomingTransactions). Solid dot = bill out, hollow dot = income in.
 * Presentational: feed `items`; wire to useRecurringTransactions later.
 */
export default function UpcomingCalendar({
  items,
  className,
}: {
  items: UpcomingItem[];
  className?: string;
}) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const currentDay = today.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();
  const monthName = today.toLocaleDateString('en-US', { month: 'long' });

  const upcoming = items.filter((i) => i.day >= currentDay);
  const totalOut = upcoming
    .filter((i) => i.direction === 'out')
    .reduce((s, i) => s + i.amount, 0);

  const cells: (number | null)[] = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className={cn('rounded-3xl border border-border bg-card p-5', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Upcoming bills</span>
        <span className="text-xs text-muted-foreground">{upcoming.length} upcoming</span>
      </div>
      <div className="mt-1 font-display text-3xl tracking-tight text-foreground tabular-nums">
        ${totalOut.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1">
        {weekDays.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (day === null) return <div key={`p${idx}`} aria-hidden />;
          const dayItems = items.filter((i) => i.day === day);
          const isToday = day === currentDay;
          const isPast = day < currentDay;
          const dayOut = dayItems.filter((i) => i.direction === 'out').reduce((s, i) => s + i.amount, 0);
          return (
            <div
              key={day}
              className={cn(
                'flex aspect-square flex-col items-center justify-between rounded-md border p-1',
                isPast ? 'border-border/40 opacity-60' : 'border-border',
                isToday && 'ring-1 ring-foreground/40',
              )}
            >
              <span
                className={cn(
                  'text-[10px] font-medium',
                  isToday
                    ? 'flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[9px] text-background'
                    : 'text-foreground',
                )}
              >
                {day}
              </span>
              {dayItems.length > 0 ? (
                <div className="flex -space-x-1">
                  {(dayItems.length > 3 ? dayItems.slice(0, 2) : dayItems.slice(0, 3)).map((it) => (
                    <span
                      key={it.id}
                      className={cn(
                        'flex h-3.5 w-3.5 items-center justify-center rounded-full border border-background',
                        it.direction === 'in' ? 'bg-background ring-1 ring-foreground/50' : 'bg-foreground',
                      )}
                    >
                      {it.direction === 'in' && <DollarSign className="h-2 w-2 text-foreground" />}
                    </span>
                  ))}
                  {dayItems.length > 3 && (
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-background bg-secondary text-secondary-foreground">
                      <Plus className="h-2 w-2" />
                    </span>
                  )}
                </div>
              ) : (
                <span className="h-3.5" />
              )}
              <span className="w-full truncate text-center text-[8px] font-medium text-muted-foreground">
                {dayOut > 0 ? fmt(dayOut) : ' '}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
        <span>
          {monthName} {currentDay}–{daysInMonth}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-foreground" />
            Bills
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-background ring-1 ring-foreground/50" />
            Income
          </span>
        </span>
      </div>
    </div>
  );
}
