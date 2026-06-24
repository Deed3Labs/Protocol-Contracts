import { cn } from '@/lib/utils';

type Status = 'completed' | 'pending' | 'failed';

interface ActivityItem {
  id: string;
  name: string;
  sub: string;
  amount: string;
  status: Status;
  initials: string;
}

const items: ActivityItem[] = [
  { id: '1', name: 'To Ahmad Sulaiman', sub: 'Transfer · Today', amount: '-$574.00', status: 'pending', initials: 'AS' },
  { id: '2', name: 'From Macellyn Annya', sub: 'Deposit · Today', amount: '+$349.00', status: 'completed', initials: 'MA' },
  { id: '3', name: 'To Samuel Khan', sub: 'Transfer · Yesterday', amount: '-$134.00', status: 'failed', initials: 'SK' },
  { id: '4', name: 'Payroll — Acme', sub: 'Deposit · Yesterday', amount: '+$3,200.00', status: 'completed', initials: 'AC' },
  { id: '5', name: 'Rent — Maple Apartments', sub: 'Bill · Jul 1', amount: '-$1,850.00', status: 'pending', initials: 'MA' },
];

const statusStyle: Record<Status, string> = {
  completed: 'text-foreground',
  pending: 'text-muted-foreground',
  failed: 'text-destructive',
};

/** Recent activity list with avatars + status, dashboard-style. */
export default function RecentActivity({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-5', className)}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">Recent activity</h3>
        <button type="button" className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          See all
        </button>
      </div>
      <div className="divide-y divide-border">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-medium text-secondary-foreground">
              {it.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{it.name}</div>
              <div className="truncate text-xs text-muted-foreground">{it.sub}</div>
            </div>
            <div className="text-right">
              <div className="font-display text-base tracking-tight text-foreground tabular-nums">{it.amount}</div>
              <div className={cn('text-[11px] font-medium capitalize', statusStyle[it.status])}>{it.status}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
