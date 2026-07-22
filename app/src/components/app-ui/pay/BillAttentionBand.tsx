import { useMemo } from 'react';
import { AlertCircle, CalendarClock, Flame, CircleCheck } from 'lucide-react';
import { billTiming } from '@/lib/billStatus';
import { rewardMultiplier, MAX_MULTIPLIER, type Bill } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { cn } from '@/lib/utils';

/*
 * What needs a decision right now — and nothing else.
 *
 * The band only renders cards that have something to say: no overdue bills means no overdue card. If
 * nothing is urgent at all it collapses to a single calm line, so an on-top-of-things member isn't
 * shown three cards of zeroes every week.
 */
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function BillAttentionBand({ bills, streak, onSelect }: { bills: Bill[]; streak: number; onSelect?: (id: string) => void }) {
  const { accelerated } = useMemberProfile();

  const { overdue, dueSoon } = useMemo(() => {
    const o: { bill: Bill; days: number }[] = [];
    const d: { bill: Bill; days: number }[] = [];
    for (const bill of bills) {
      const t = billTiming(bill.dueDay, bill.lastPaidAt);
      if (t.status === 'overdue') o.push({ bill, days: t.daysUntil ?? 0 });
      else if (t.status === 'due-soon') d.push({ bill, days: t.daysUntil ?? 0 });
    }
    o.sort((a, b) => a.days - b.days);
    d.sort((a, b) => a.days - b.days);
    return { overdue: o, dueSoon: d };
  }, [bills]);

  const multiplier = rewardMultiplier(streak, accelerated);
  const atMax = multiplier >= MAX_MULTIPLIER;
  const nextTierIn = Math.max(0, (Math.floor(Math.max(streak, 0) / 6) + 1) * 6 - streak);

  const sum = (rows: { bill: Bill }[]) => rows.reduce((n, r) => n + (r.bill.amount || 0), 0);
  const names = (rows: { bill: Bill }[]) => rows.slice(0, 2).map((r) => r.bill.name).join(' · ') + (rows.length > 2 ? ` +${rows.length - 2}` : '');

  // Calm state: nothing overdue, nothing due this week.
  if (overdue.length === 0 && dueSoon.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-border px-4 py-3">
        <CircleCheck className="h-4 w-4 shrink-0 text-positive" />
        <span className="min-w-0 flex-1 text-sm text-foreground">
          {bills.length === 0 ? 'No bills yet' : 'Nothing due this week'}
        </span>
        {streak > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Flame className="h-3.5 w-3.5 text-amber-500" />
            {streak}-month streak · {multiplier}×
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {overdue.length > 0 && (
        <button
          type="button"
          onClick={() => onSelect?.(overdue[0].bill.id)}
          className="rounded-xl bg-negative/10 p-3 text-left transition-opacity hover:opacity-90"
        >
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-negative">
            <AlertCircle className="h-3.5 w-3.5" /> Overdue
          </span>
          <span className="mt-0.5 block font-display text-lg tracking-tight text-negative">{fmt(sum(overdue))}</span>
          <span className="block truncate text-[11px] text-negative/80">{names(overdue)}</span>
        </button>
      )}

      {dueSoon.length > 0 && (
        <button
          type="button"
          onClick={() => onSelect?.(dueSoon[0].bill.id)}
          className="rounded-xl bg-amber-500/10 p-3 text-left transition-opacity hover:opacity-90"
        >
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            <CalendarClock className="h-3.5 w-3.5" /> Due this week
          </span>
          <span className="mt-0.5 block font-display text-lg tracking-tight text-amber-600 dark:text-amber-400">{fmt(sum(dueSoon))}</span>
          <span className="block truncate text-[11px] text-amber-600/80 dark:text-amber-400/80">{names(dueSoon)}</span>
        </button>
      )}

      <div className={cn('rounded-xl p-3', streak > 0 ? 'bg-positive/10' : 'bg-secondary')}>
        <span className={cn('flex items-center gap-1.5 text-[11px] font-medium', streak > 0 ? 'text-positive' : 'text-muted-foreground')}>
          <Flame className="h-3.5 w-3.5" /> On-time streak
        </span>
        <span className={cn('mt-0.5 block font-display text-lg tracking-tight', streak > 0 ? 'text-positive' : 'text-foreground')}>
          {streak} {streak === 1 ? 'month' : 'months'}
        </span>
        <span className={cn('block truncate text-[11px]', streak > 0 ? 'text-positive/80' : 'text-muted-foreground')}>
          {accelerated || atMax ? `Earning ${multiplier}×` : `${multiplier}× now · ${Math.min(multiplier + 0.25, MAX_MULTIPLIER)}× in ${nextTierIn}`}
        </span>
      </div>
    </div>
  );
}
