import { cn } from '@/lib/utils';

const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const fmt = (a: number) => (a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : a > 0 ? `$${Math.round(a)}` : '');

/**
 * Spend-intensity heatmap calendar (restyle of the old portfolio SpendTracker).
 * Each day darkens with spend relative to the month's max — scannable spend rhythm.
 * Presentational: feed `spendingByDay` (day-of-month -> amount); wire to
 * usePlaidRecentTransactions later.
 */
export default function SpendHeatmap({
  spendingByDay,
  className,
}: {
  spendingByDay: Record<number, number>;
  className?: string;
}) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const currentDay = today.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();
  const monthName = today.toLocaleDateString('en-US', { month: 'long' });

  const values = Object.values(spendingByDay).filter((v) => v > 0);
  const max = values.length ? Math.max(...values, 1) : 1;
  const total = values.reduce((s, v) => s + v, 0);

  const cells: (number | null)[] = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className={cn('rounded-3xl border border-border bg-card p-5', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Spend this month</span>
        <span className="text-xs text-muted-foreground">
          {monthName} 1–{currentDay}
        </span>
      </div>
      <div className="mt-1 font-display text-3xl tracking-tight text-foreground tabular-nums">
        ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
          const amount = spendingByDay[day] ?? 0;
          const isPast = day <= currentDay;
          const isToday = day === currentDay;
          const intensity = amount > 0 ? Math.min(amount / max, 1) : 0;
          const inverted = isPast && intensity > 0.55;
          return (
            <div
              key={day}
              className={cn(
                'relative flex aspect-square flex-col items-start justify-between rounded-md border p-1',
                isPast ? 'border-border' : 'border-border/40',
                isToday && 'ring-1 ring-foreground/40',
              )}
            >
              <div
                className="pointer-events-none absolute inset-0 rounded-md bg-foreground"
                style={{ opacity: isPast ? intensity : 0 }}
                aria-hidden
              />
              <span
                className={cn(
                  'relative z-10 text-[10px] font-medium',
                  inverted ? 'text-background' : isPast ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {day}
              </span>
              <span
                className={cn(
                  'relative z-10 w-full truncate text-[9px] font-medium',
                  inverted ? 'text-background' : 'text-muted-foreground',
                )}
              >
                {isPast ? fmt(amount) : ''}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
        <span className="text-[11px] text-muted-foreground">Less</span>
        <div className="flex gap-0.5">
          {[0.15, 0.35, 0.55, 0.78, 1].map((o, i) => (
            <div key={i} className="h-3 w-3 rounded-[3px] bg-foreground" style={{ opacity: o }} />
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">More</span>
      </div>
    </div>
  );
}
