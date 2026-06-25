import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal, ArrowLeftRight, ArrowDownLeft, Briefcase, Receipt, CreditCard, Repeat, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import TransactionFilterModal, { type Category, type AdvFilters, DEFAULT_ADV, advCount } from './TransactionFilterModal';

type Status = 'completed' | 'pending' | 'failed';

interface Activity {
  id: string;
  name: string;
  category: Category;
  date: string;
  amount: number; // signed: + in, - out
  status: Status;
}

const CATEGORY: Record<Category, { icon: LucideIcon; tint: string }> = {
  Transfer: { icon: ArrowLeftRight, tint: 'bg-info/10 text-info' },
  Deposit: { icon: ArrowDownLeft, tint: 'bg-positive/10 text-positive' },
  Payroll: { icon: Briefcase, tint: 'bg-positive/10 text-positive' },
  Bill: { icon: Receipt, tint: 'bg-negative/10 text-negative' },
  Card: { icon: CreditCard, tint: 'bg-secondary text-foreground' },
  Subscription: { icon: Repeat, tint: 'bg-violet-500/10 text-violet-500 dark:text-violet-400' },
};

const statusStyle: Record<Status, string> = {
  completed: 'bg-positive/10 text-positive',
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  failed: 'bg-negative/10 text-negative',
};

const items: Activity[] = [
  { id: '1', name: 'Ahmad Sulaiman', category: 'Transfer', date: 'Today', amount: -574, status: 'pending' },
  { id: '2', name: 'Macellyn Annya', category: 'Deposit', date: 'Today', amount: 349, status: 'completed' },
  { id: '3', name: 'Samuel Khan', category: 'Transfer', date: 'Yesterday', amount: -134, status: 'failed' },
  { id: '4', name: 'Payroll — Acme Inc.', category: 'Payroll', date: 'Yesterday', amount: 3200, status: 'completed' },
  { id: '5', name: 'Rent — Maple Apartments', category: 'Bill', date: 'Jul 1', amount: -1850, status: 'pending' },
  { id: '6', name: 'Spotify Premium', category: 'Subscription', date: 'Jun 24', amount: -12, status: 'completed' },
  { id: '7', name: 'Card payment', category: 'Card', date: 'Jun 23', amount: -320, status: 'completed' },
  { id: '8', name: 'Refund — Amazon', category: 'Deposit', date: 'Jun 22', amount: 64, status: 'completed' },
];

const FILTERS = ['All', 'Income', 'Spending', 'Transfers', 'Pending'] as const;
type Filter = (typeof FILTERS)[number];

function money(n: number) {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : '+'}$${abs}`;
}

/**
 * Recent activity — a searchable, filterable transaction list. Quick chips, a search
 * box, and an advanced filter modal (categories, status, direction, amount range).
 * Category icon + tint, signed amount (income green), and a colored status pill.
 */
export default function RecentActivity({ className }: { className?: string }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [adv, setAdv] = useState<AdvFilters>(DEFAULT_ADV);
  const [modalOpen, setModalOpen] = useState(false);
  const activeAdv = advCount(adv);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (q && !it.name.toLowerCase().includes(q) && !it.category.toLowerCase().includes(q)) return false;
      // quick chips
      if (filter === 'Income' && it.amount <= 0) return false;
      if (filter === 'Spending' && it.amount >= 0) return false;
      if (filter === 'Transfers' && it.category !== 'Transfer') return false;
      if (filter === 'Pending' && it.status !== 'pending') return false;
      // advanced
      if (!adv.categories[it.category]) return false;
      if (adv.status !== 'all' && it.status !== adv.status) return false;
      if (adv.direction === 'in' && it.amount <= 0) return false;
      if (adv.direction === 'out' && it.amount >= 0) return false;
      const abs = Math.abs(it.amount);
      if (abs < adv.amount[0] || abs > adv.amount[1]) return false;
      return true;
    });
  }, [query, filter, adv]);

  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-5', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Recent activity</h3>
        <button type="button" className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          See all
        </button>
      </div>

      {/* search + advanced filters */}
      <div className="mt-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transactions"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          aria-label="Advanced filters"
          className={cn(
            'relative flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-secondary',
            activeAdv ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeAdv > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {activeAdv}
            </span>
          )}
        </button>
      </div>

      {/* quick chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* list */}
      <div className="mt-1 flex-1 divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No transactions found.</div>
        ) : (
          filtered.map((it) => {
            const { icon: Icon, tint } = CATEGORY[it.category];
            return (
              <div key={it.id} className="flex items-center gap-3 py-3 sm:gap-4">
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', tint)}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{it.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {it.category} · {it.date}
                  </div>
                </div>
                {/* status — own column on desktop */}
                <span className={cn('hidden shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium capitalize sm:inline-flex', statusStyle[it.status])}>
                  {it.status}
                </span>
                {/* amount (mobile shows status beneath) */}
                <div className="flex shrink-0 flex-col items-end gap-1 sm:w-24">
                  <div
                    className={cn(
                      'font-display text-base tracking-tight tabular-nums',
                      it.amount > 0 ? 'text-positive' : 'text-foreground',
                    )}
                  >
                    {money(it.amount)}
                  </div>
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize sm:hidden', statusStyle[it.status])}>
                    {it.status}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <TransactionFilterModal open={modalOpen} onOpenChange={setModalOpen} value={adv} onApply={setAdv} />
    </div>
  );
}
