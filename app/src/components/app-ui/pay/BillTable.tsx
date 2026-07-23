import { useMemo, useState } from 'react';
import { Plus, Search, ChevronRight, Sparkles } from 'lucide-react';
import { scheduleEntry, PERIOD_DAYS, type SchedulePeriod, type BillStatus } from '@/lib/billStatus';
import { CATEGORY_TINT } from '@/components/app-ui/pay/categoryStyle';
import { usePay, creditsFor, type Bill } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { cn } from '@/lib/utils';

/*
 * The bill schedule as a table on the PAGE — not boxed in a card. The toolbar and column headers sit
 * on the page, rows separate themselves with hairline dividers, and there's no outer border/fill; the
 * table uses the page surface directly (like the reference dashboards). Cards are reserved for the top
 * metrics, where they earn their weight; a list of bills is tabular data and reads as rows + columns.
 *
 * Still an agenda: rows are ordered by what's coming due, a period toggle sets the window, and a
 * monthly bill is one row whose count consolidates the recurrence ("×3" in quarter), never repeated.
 */
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt0 = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const PERIODS: [SchedulePeriod, string][] = [
  ['week', 'Week'],
  ['month', 'Month'],
  ['quarter', 'Quarter'],
];

const STATUS_PILL: Record<BillStatus, string> = {
  overdue: 'bg-negative/10 text-negative',
  'due-soon': 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  upcoming: 'bg-secondary text-muted-foreground',
  paid: 'bg-positive/10 text-positive',
  undated: 'bg-secondary text-muted-foreground',
};
const STATUS_WORD: Record<BillStatus, string> = {
  overdue: 'Overdue',
  'due-soon': 'Due soon',
  upcoming: 'Upcoming',
  paid: 'Paid',
  undated: 'No date',
};

/* Column template: Bill | Due | Amount | Credits | Status | chevron. Secondary columns drop out at
   narrow widths so the same markup collapses to Bill · Amount · Status on a phone. */
const GRID = 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 sm:grid-cols-[minmax(0,2fr)_88px_100px_84px_24px] md:grid-cols-[minmax(0,2.2fr)_92px_104px_76px_84px_24px]';

export default function BillTable({
  bills,
  onSelect,
  onAdd,
}: {
  bills: Bill[];
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const { streak } = usePay();
  const { accelerated } = useMemberProfile();
  const [period, setPeriod] = useState<SchedulePeriod>('month');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const windowDays = PERIOD_DAYS[period];
    return bills
      .map((bill) => ({ bill, entry: scheduleEntry(bill.dueDay, bill.lastPaidAt, windowDays) }))
      .filter(
        ({ bill, entry }) =>
          (entry.count > 0 || !bill.dueDay) && (!q || `${bill.name} ${bill.payee ?? ''}`.toLowerCase().includes(q)),
      )
      .sort((a, b) => (a.entry.next?.getTime() ?? Infinity) - (b.entry.next?.getTime() ?? Infinity));
  }, [bills, period, query]);

  const periodLabel = period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'this quarter';

  return (
    <div>
      {/* toolbar — on the page, not boxed */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-lg bg-secondary/60 p-0.5">
          {PERIODS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriod(id)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                period === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {bills.length > 5 && (
          <div className="relative min-w-0 flex-1 sm:max-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bills"
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
            />
          </div>
        )}

        <button
          type="button"
          onClick={onAdd}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" /> Add a bill
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="border-t border-border px-4 py-14 text-center">
          <div className="text-sm font-medium text-foreground">
            {query ? 'No bills match' : bills.length === 0 ? 'No bills yet' : `Nothing due ${periodLabel}`}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {query
              ? 'Try a different search.'
              : bills.length === 0
                ? 'Add your rent, utilities and subscriptions to track them and earn equity.'
                : "You're all caught up."}
          </div>
          {bills.length === 0 && !query && (
            <button
              type="button"
              onClick={onAdd}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <Plus className="h-3.5 w-3.5" /> Add your first bill
            </button>
          )}
        </div>
      ) : (
        <>
          {/* column header — sits on the page above the divided rows */}
          <div className={cn(GRID, 'border-y border-border px-2 py-2 text-[11px] font-medium text-muted-foreground')}>
            <span>Bill</span>
            <span className="hidden sm:block">Due</span>
            <span>Amount</span>
            <span className="hidden md:block">Earns</span>
            <span className="hidden sm:block">Status</span>
            <span className="hidden sm:block" />
          </div>

          <div className="divide-y divide-border">
            {rows.map(({ bill, entry }) => {
              const count = entry.count;
              const earns = entry.status === 'paid' ? 0 : creditsFor(bill, streak, bill.amount, accelerated);
              return (
                <button
                  key={bill.id}
                  type="button"
                  onClick={() => onSelect(bill.id)}
                  className={cn(GRID, 'w-full px-2 py-3 text-left transition-colors hover:bg-secondary/30')}
                >
                  {/* Bill */}
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', CATEGORY_TINT[bill.type])}>
                      <bill.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{bill.name}</span>
                        {bill.source === 'plaid' && (
                          <span className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] font-medium text-muted-foreground">Auto</span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {bill.payee && bill.payee !== bill.name ? bill.payee : bill.dueDay ? 'Monthly' : 'One-time'}
                      </span>
                    </span>
                  </span>

                  {/* Due */}
                  <span className={cn('hidden text-xs tabular-nums sm:block', entry.status === 'overdue' ? 'text-negative' : 'text-muted-foreground')}>
                    {entry.next ? shortDate(entry.next) : '—'}
                  </span>

                  {/* Amount */}
                  <span className="text-right sm:text-left">
                    <span className="block font-display text-sm tabular-nums text-foreground">{bill.amount > 0 ? fmt(bill.amount) : '—'}</span>
                    {count > 1 && <span className="block text-[10px] tabular-nums text-muted-foreground sm:hidden">×{count} · {fmt0(bill.amount * count)}</span>}
                  </span>

                  {/* Earns */}
                  <span className="hidden md:block">
                    {count > 1 ? (
                      <span className="text-xs tabular-nums text-muted-foreground">×{count}</span>
                    ) : earns > 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-xs tabular-nums text-positive">
                        <Sparkles className="h-3 w-3" />+{earns.toLocaleString('en-US')}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </span>

                  {/* Status */}
                  <span className="justify-self-end sm:justify-self-start">
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_PILL[entry.status])}>
                      {STATUS_WORD[entry.status]}
                    </span>
                  </span>

                  {/* affordance */}
                  <ChevronRight className="hidden h-4 w-4 text-muted-foreground/50 sm:block" />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
