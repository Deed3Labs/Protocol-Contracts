import { useMemo } from 'react';
import { billTiming } from '@/lib/billStatus';
import { usePay, BILL_TYPES, type BillType } from '@/context/PayContext';
import { CATEGORY_BAR } from '@/components/app-ui/pay/categoryStyle';
import { cn } from '@/lib/utils';

/*
 * Where this month's bills go, broken down by category — the same bar treatment as the credit line on
 * Borrow (h-6 track, hairline-gapped segments, inline legend, remainder on the right), in colour.
 *
 * Split by CATEGORY rather than by status: overdue is already carried by the metrics, the list rows
 * and the detail pane, so a fourth telling of it adds nothing. What the page doesn't say anywhere
 * else is the shape of someone's monthly obligations.
 *
 * Segments are dollars. Equity credits are points, so they sit in the header rather than the bar.
 */
const fmt2 = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const nInt = (n: number) => Math.round(n).toLocaleString('en-US');

export default function MonthProgress() {
  const { bills, summary } = usePay();

  const { categories, total, paid, remaining } = useMemo(() => {
    const byType = new Map<BillType, number>();
    let all = 0;
    let settled = 0;
    for (const b of bills) {
      const amount = b.amount || 0;
      if (amount <= 0) continue;
      all += amount;
      byType.set(b.type, (byType.get(b.type) ?? 0) + amount);
      if (billTiming(b.dueDay, b.lastPaidAt).status === 'paid') settled += amount;
    }
    const rows = BILL_TYPES.filter((t) => (byType.get(t.value) ?? 0) > 0)
      .map((t) => ({ type: t.value, label: t.label, amount: byType.get(t.value) as number }))
      .sort((a, b) => b.amount - a.amount);
    return { categories: rows, total: all, paid: settled, remaining: Math.max(0, all - settled) };
  }, [bills]);

  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const credits = summary?.equityThisMonth ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">This month's bills</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {credits > 0 && (
            <span className="rounded-full bg-positive/10 px-2 py-0.5 text-[11px] font-medium text-positive">
              +{nInt(credits)} credits
            </span>
          )}
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
            {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-display text-4xl tracking-tight tabular-nums text-foreground">{fmt2(total)}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            across {bills.length} {bills.length === 1 ? 'bill' : 'bills'}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-medium tabular-nums text-foreground">{fmt2(paid)}</div>
          <div className="text-[11px] text-muted-foreground">paid</div>
        </div>
      </div>

      <div className="mt-3 flex h-6 gap-0.5 overflow-hidden rounded-lg bg-secondary">
        {categories.map((c) => (
          <div key={c.type} className={CATEGORY_BAR[c.type]} style={{ width: `${total > 0 ? (c.amount / total) * 100 : 0}%` }} />
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 text-[10px]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
          {categories.length > 0 ? (
            categories.map((c) => (
              <span key={c.type} className="whitespace-nowrap">
                <span className={cn('mr-1 inline-block h-1.5 w-1.5 rounded-sm align-middle', CATEGORY_BAR[c.type])} />
                <span className="font-medium text-muted-foreground">{c.label}</span>{' '}
                <span className="tabular-nums text-foreground">{fmt(c.amount)}</span>
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">No bills tracked yet</span>
          )}
        </div>
        <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{fmt(remaining)} left</span>
      </div>
    </div>
  );
}
