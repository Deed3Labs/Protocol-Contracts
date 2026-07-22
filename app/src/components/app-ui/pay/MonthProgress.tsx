import { useMemo } from 'react';
import { Check, Clock, AlertCircle, Sparkles } from 'lucide-react';
import { billTiming } from '@/lib/billStatus';
import { usePay } from '@/context/PayContext';
import { cn } from '@/lib/utils';

/*
 * How the month is going, as one bar.
 *
 * Segments are DOLLARS ONLY — paid, overdue, still to come. Equity credits are points, not money, so
 * they're reported alongside rather than as a fourth segment: putting them in the same proportional
 * bar would make the widths meaningless (a 200-credit bill isn't "200 dollars wide").
 */
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const nInt = (n: number) => Math.round(n).toLocaleString('en-US');

export default function MonthProgress() {
  const { bills, summary } = usePay();

  const { paid, overdue, upcoming, total } = useMemo(() => {
    let p = 0;
    let o = 0;
    let u = 0;
    for (const b of bills) {
      const amount = b.amount || 0;
      const t = billTiming(b.dueDay, b.lastPaidAt);
      if (t.status === 'paid') p += amount;
      else if (t.status === 'overdue') o += amount;
      else u += amount;
    }
    return { paid: p, overdue: o, upcoming: u, total: p + o + u };
  }, [bills]);

  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const monthName = now.toLocaleDateString('en-US', { month: 'long' });
  const credits = summary?.equityThisMonth ?? 0;

  const pct = (v: number) => (total > 0 ? `${(v / total) * 100}%` : '0%');
  const done = total > 0 ? Math.round((paid / total) * 100) : 0;

  const segments = [
    { key: 'paid', value: paid, label: 'Paid', icon: Check, bar: 'bg-positive', pill: 'bg-positive/10 text-positive' },
    { key: 'overdue', value: overdue, label: 'Overdue', icon: AlertCircle, bar: 'bg-negative', pill: 'bg-negative/10 text-negative' },
    { key: 'upcoming', value: upcoming, label: 'To come', icon: Clock, bar: 'bg-muted-foreground/30', pill: 'bg-secondary text-muted-foreground' },
  ].filter((s) => s.value > 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4 lg:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-muted-foreground">{monthName}</span>
          {total > 0 && <span className="font-display text-sm tabular-nums text-foreground">{done}% paid</span>}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
        </span>
      </div>

      {total > 0 ? (
        <>
          <div className="mt-3 flex h-2.5 gap-1 overflow-hidden">
            {segments.map((s) => (
              <span key={s.key} className={cn('rounded-full transition-[width] duration-500', s.bar)} style={{ width: pct(s.value) }} />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {segments.map((s) => (
              <span key={s.key} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', s.pill)}>
                <s.icon className="h-3.5 w-3.5" />
                {s.label}
                <span className="tabular-nums">{money(s.value)}</span>
              </span>
            ))}
            {credits > 0 && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-positive" />
                <span className="font-medium tabular-nums text-positive">+{nInt(credits)}</span> credits earned
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing billed this month yet. Add a bill to start tracking it here.
        </p>
      )}
    </div>
  );
}
