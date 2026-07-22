import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { scheduleEntry, PERIOD_DAYS, type SchedulePeriod } from '@/lib/billStatus';
import { STATUS_TEXT } from '@/components/app-ui/pay/statusStyle';
import { CATEGORY_TINT } from '@/components/app-ui/pay/categoryStyle';
import { usePay, creditsFor, type Bill } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { cn } from '@/lib/utils';

/*
 * The bill schedule — the "master" half of the page.
 *
 * An agenda, not an alphabetised list: bills are ordered by what's coming due, with the date on every
 * row. A period toggle (week / month / quarter) sets the window. A monthly bill is ONE row whose
 * count reflects the period — three payments in a quarter show as "×3", not three duplicate rows.
 * Bills with nothing due in the window (paid this cycle in week/month view) simply drop out; the
 * agenda is what needs paying, ordered by when.
 */
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt0 = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const PERIODS: [SchedulePeriod, string][] = [
  ['week', 'Week'],
  ['month', 'Month'],
  ['quarter', 'Quarter'],
];

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

  // Decorate every bill with its window presence, then keep only what's actually due in the period
  // (plus undated bills, which have no schedule to fall outside of) and order by soonest due.
  const { rows, dueTotal, paymentCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const windowDays = PERIOD_DAYS[period];
    const decorated = bills
      .map((bill) => ({ bill, entry: scheduleEntry(bill.dueDay, bill.lastPaidAt, windowDays) }))
      .filter(
        ({ bill, entry }) =>
          (entry.count > 0 || !bill.dueDay) && (!q || `${bill.name} ${bill.payee ?? ''}`.toLowerCase().includes(q)),
      )
      .sort((a, b) => {
        const at = a.entry.next?.getTime() ?? Infinity; // undated → end
        const bt = b.entry.next?.getTime() ?? Infinity;
        return at - bt;
      });
    // Undated bills count as one obligation; dated bills use their occurrence count in the window.
    const occ = (bill: Bill, count: number) => Math.max(count, bill.dueDay ? 0 : 1);
    const total = decorated.reduce((n, { bill, entry }) => n + (bill.amount || 0) * occ(bill, entry.count), 0);
    const payments = decorated.reduce((n, { bill, entry }) => n + occ(bill, entry.count), 0);
    return { rows: decorated, dueTotal: total, paymentCount: payments };
  }, [bills, period, query]);

  const periodLabel = period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'this quarter';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* period toggle + add */}
      <div className="flex items-center gap-2 border-b border-border p-2">
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

      {/* period total */}
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className="font-display text-lg tabular-nums tracking-tight text-foreground">{fmt(dueTotal)}</span>
        <span className="text-[11px] text-muted-foreground">
          {paymentCount} {paymentCount === 1 ? 'payment' : 'payments'} {periodLabel}
        </span>
      </div>

      {bills.length > 5 && (
        <div className="relative border-b border-border px-2 py-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bills"
            className="w-full rounded-lg bg-secondary/50 py-1.5 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rows.length === 0 ? (
          <div className="px-3 py-10 text-center">
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
            return (
              <button
                key={bill.id}
                type="button"
                onClick={() => onSelect(bill.id)}
                aria-current={selected}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors',
                  selected ? 'bg-secondary' : 'hover:bg-secondary/50',
                )}
              >
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', CATEGORY_TINT[bill.type])}>
                  <bill.icon className="h-[18px] w-[18px]" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">{bill.name}</span>
                    {bill.source === 'plaid' && (
                      <span className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] font-medium text-muted-foreground">Auto</span>
                    )}
                  </span>
                  <span className={cn('block truncate text-[11px]', STATUS_TEXT[entry.status])}>
                    {entry.status === 'overdue'
                      ? entry.label
                      : entry.next
                        ? `${shortDate(entry.next)}${bill.dueDay ? ' · Monthly' : ''}`
                        : 'No date'}
                    {entry.status === 'overdue' && streak > 0 && ' · streak at risk'}
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span className="block font-display text-sm tabular-nums text-foreground">
                    {bill.amount > 0 ? fmt(bill.amount) : '—'}
                  </span>
                  {count > 1 ? (
                    <span className="block text-[11px] tabular-nums text-muted-foreground">
                      ×{count} · {fmt0(bill.amount * count)}
                    </span>
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
