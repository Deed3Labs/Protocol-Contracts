import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { billTiming, billUrgency, type BillStatus } from '@/lib/billStatus';
import { STATUS_TINT, STATUS_TEXT } from '@/components/app-ui/pay/statusStyle';
import type { Bill } from '@/context/PayContext';
import { cn } from '@/lib/utils';

/*
 * The bill list — the "master" half of the page. Rows are sorted by what needs attention first, not
 * alphabetically, so the thing you came to deal with is at the top.
 *
 * Paid bills stay in the list (greyed) rather than disappearing: seeing the month fill up is the
 * point. Filters derive their counts from the same billTiming() the rows render from, so a tab can
 * never claim a count the list doesn't show.
 */
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type FilterId = 'all' | 'upcoming' | 'overdue' | 'paid';
const MATCHES: Record<FilterId, (s: BillStatus) => boolean> = {
  all: () => true,
  upcoming: (s) => s === 'due-soon' || s === 'upcoming' || s === 'undated',
  overdue: (s) => s === 'overdue',
  paid: (s) => s === 'paid',
};

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
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');

  // Decorate once: every row, tab count and sort reads the same timing.
  const decorated = useMemo(
    () => bills.map((bill) => ({ bill, timing: billTiming(bill.dueDay, bill.lastPaidAt) })).sort((a, b) => billUrgency(a.timing) - billUrgency(b.timing)),
    [bills],
  );

  const counts = useMemo(() => {
    const c: Record<FilterId, number> = { all: decorated.length, upcoming: 0, overdue: 0, paid: 0 };
    for (const d of decorated) {
      if (MATCHES.upcoming(d.timing.status)) c.upcoming += 1;
      if (MATCHES.overdue(d.timing.status)) c.overdue += 1;
      if (MATCHES.paid(d.timing.status)) c.paid += 1;
    }
    return c;
  }, [decorated]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return decorated.filter(
      (d) => MATCHES[filter](d.timing.status) && (!q || `${d.bill.name} ${d.bill.payee ?? ''}`.toLowerCase().includes(q)),
    );
  }, [decorated, filter, query]);

  // Only offer tabs that have anything in them, so an empty "Overdue" never nags.
  const tabs = ([
    ['all', 'All'],
    ['upcoming', 'Upcoming'],
    ['overdue', 'Overdue'],
    ['paid', 'Paid'],
  ] as [FilterId, string][]).filter(([id]) => id === 'all' || counts[id] > 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              filter === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            {label} {counts[id] > 0 && <span className="tabular-nums opacity-70">{counts[id]}</span>}
          </button>
        ))}
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
            <div className="text-sm font-medium text-foreground">{query ? 'No bills match' : bills.length === 0 ? 'No bills yet' : 'Nothing here'}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {query ? 'Try a different search.' : bills.length === 0 ? 'Add your rent, utilities and subscriptions.' : 'Try another filter.'}
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
          rows.map(({ bill, timing }) => {
            const selected = bill.id === selectedId;
            return (
              <button
                key={bill.id}
                type="button"
                onClick={() => onSelect(bill.id)}
                aria-current={selected}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl p-2.5 text-left transition-colors',
                  selected ? 'bg-secondary' : 'hover:bg-secondary/50',
                )}
              >
                <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', STATUS_TINT[timing.status])}>
                  <bill.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={cn('truncate text-sm', timing.status === 'paid' ? 'text-muted-foreground' : 'font-medium text-foreground')}>
                      {bill.name}
                    </span>
                    {bill.source === 'plaid' && (
                      <span className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] font-medium text-muted-foreground">Auto</span>
                    )}
                  </span>
                  <span className={cn('block truncate text-[11px]', STATUS_TEXT[timing.status])}>{timing.label || 'No due date'}</span>
                </span>
                <span className={cn('shrink-0 text-sm tabular-nums', timing.status === 'paid' ? 'text-muted-foreground' : 'font-medium text-foreground')}>
                  {bill.amount > 0 ? fmt(bill.amount) : '—'}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
