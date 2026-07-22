import { useMemo, useState } from 'react';
import { Plus, Search, Receipt } from 'lucide-react';
import { scheduleEntry, PERIOD_DAYS, type SchedulePeriod, type BillStatus } from '@/lib/billStatus';
import { CATEGORY_BAR } from '@/components/app-ui/pay/categoryStyle';
import { usePay, creditsFor, type Bill } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { cn } from '@/lib/utils';

/*
 * The bill schedule — the "master" half of the page.
 *
 * An agenda of cards, not an icon list: each bill is a card led by a calendar date chip, ordered by
 * what's coming due. A period toggle (week / month / quarter) sets the window; a monthly bill is ONE
 * card whose count reflects the period ("×3"), never repeated. Two colour channels — the chip carries
 * urgency (overdue / due soon), a dot carries category — so a glance reads both.
 */
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt0 = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const PERIODS: [SchedulePeriod, string][] = [
  ['week', 'Week'],
  ['month', 'Month'],
  ['quarter', 'Quarter'],
];

/** Chip tint by urgency — the date is where "when" lives, so it's where urgency should show. */
const CHIP: Record<BillStatus, string> = {
  overdue: 'bg-negative/10 text-negative',
  'due-soon': 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  upcoming: 'bg-secondary text-foreground',
  paid: 'bg-secondary text-muted-foreground',
  undated: 'bg-secondary text-muted-foreground',
};
const STATUS_WORD: Partial<Record<BillStatus, string>> = { overdue: 'Overdue', 'due-soon': 'Due soon', paid: 'Paid' };

export default function BillList({
  bills,
  selectedId,
  onSelect,
  onAdd,
}: {
  bills: Bill[];
  selectedId: string | null;
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
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:max-h-[calc(100vh-11rem)]">
      <div className="flex items-center gap-2 border-b border-border p-2.5">
        <div className="flex gap-0.5 rounded-lg bg-secondary/60 p-0.5">
          {PERIODS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriod(id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                period === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add a bill"
          className="ml-auto shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {bills.length > 5 && (
        <div className="relative border-b border-border px-2.5 py-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bills"
            className="w-full rounded-lg bg-secondary/50 py-1.5 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <div className="px-3 py-12 text-center">
            <div className="text-sm font-medium text-foreground">
              {query ? 'No bills match' : bills.length === 0 ? 'No bills yet' : `Nothing due ${periodLabel}`}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {query
                ? 'Try a different search.'
                : bills.length === 0
                  ? 'Add your rent, utilities and subscriptions.'
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
          rows.map(({ bill, entry }) => {
            const selected = bill.id === selectedId;
            const count = entry.count;
            const earns = entry.status === 'paid' ? 0 : creditsFor(bill, streak, bill.amount, accelerated);
            const statusWord = STATUS_WORD[entry.status];
            return (
              <button
                key={bill.id}
                type="button"
                onClick={() => onSelect(bill.id)}
                aria-current={selected}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors',
                  selected ? 'border-foreground/20 bg-secondary' : 'border-border hover:bg-secondary/40',
                )}
              >
                {/* calendar date chip — the "when", tinted by urgency */}
                <span className={cn('flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md', CHIP[entry.status])}>
                  {entry.next ? (
                    <>
                      <span className="text-[9px] font-medium uppercase leading-none tracking-wide opacity-70">
                        {entry.next.toLocaleDateString('en-US', { month: 'short' })}
                      </span>
                      <span className="font-display text-[13px] leading-none tabular-nums">{entry.next.getDate()}</span>
                    </>
                  ) : (
                    <Receipt className="h-4 w-4 opacity-60" />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', CATEGORY_BAR[bill.type])} />
                    <span className="truncate text-sm font-medium text-foreground">{bill.name}</span>
                    {bill.source === 'plaid' && (
                      <span className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] font-medium text-muted-foreground">Auto</span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {bill.dueDay ? 'Monthly' : 'One-time'}
                    {statusWord && (
                      <>
                        {' · '}
                        <span className={cn(entry.status === 'overdue' && 'text-negative', entry.status === 'due-soon' && 'text-amber-600 dark:text-amber-400')}>
                          {statusWord}
                        </span>
                      </>
                    )}
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span className="block font-display text-sm tabular-nums text-foreground">
                    {bill.amount > 0 ? fmt(bill.amount) : '—'}
                  </span>
                  {count > 1 ? (
                    <span className="block text-[11px] tabular-nums text-muted-foreground">×{count} · {fmt0(bill.amount * count)}</span>
                  ) : earns > 0 ? (
                    <span className="block text-[11px] tabular-nums text-positive">+{earns.toLocaleString('en-US')}</span>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
