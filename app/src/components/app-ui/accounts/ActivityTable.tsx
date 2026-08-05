import { useMemo } from 'react';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import { cn } from '@/lib/utils';

const fmtSigned = (v: number) =>
  `${v < 0 ? '−' : '+'}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtDate = (ts: number) =>
  ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

/**
 * Recent activity — Accounts only.
 *
 * A flat table on desktop (hairline row rules, no outer frame) that folds into a single-canvas
 * list on narrow screens. Kept separate from the shared RecentActivity, which Transactions also
 * renders; rewriting that component in place is what forced the earlier flat-design attempt to
 * be reverted.
 */
export default function ActivityTable({
  limit = 6,
  className,
}: {
  limit?: number;
  className?: string;
}) {
  const { items, loading } = useClearTransactions();

  const rows = useMemo(
    () => [...items].sort((a, b) => b.ts - a.ts).slice(0, limit),
    [items, limit],
  );

  return (
    <section className={cn('py-6', className)}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Recent activity
        </span>
        <a href="/transactions" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
          See all
        </a>
      </div>

      {loading && rows.length === 0 ? (
        <p className="border-t border-border py-8 text-sm text-muted-foreground">Loading activity…</p>
      ) : rows.length === 0 ? (
        <div className="border-t border-border py-8">
          <p className="text-sm text-foreground">No activity yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Payments, deposits and transfers will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                {['Transaction', 'Account', 'Status', 'Date', 'Amount'].map((h, i) => (
                  <th
                    key={h}
                    className={cn(
                      'pb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground',
                      i === 4 ? 'text-right' : 'text-left',
                      // secondary columns collapse on narrow screens rather than squeezing
                      (i === 1 || i === 2) && 'hidden md:table-cell',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => (
                <tr key={it.id} className="border-b border-border last:border-b-0">
                  <td className="py-3 pr-4 align-baseline">
                    <span className="block text-sm text-foreground">{it.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground md:hidden">
                      {fmtDate(it.ts)}
                    </span>
                  </td>
                  <td className="hidden py-3 pr-4 align-baseline text-sm text-muted-foreground md:table-cell">
                    {it.source === 'bank' ? 'Bank' : 'Clear'}
                  </td>
                  <td className="hidden py-3 pr-4 align-baseline md:table-cell">
                    <span
                      className={cn(
                        'text-xs capitalize',
                        it.status === 'failed'
                          ? 'text-negative'
                          : it.status === 'pending'
                            ? 'text-muted-foreground'
                            : 'text-foreground',
                      )}
                    >
                      {it.status}
                    </span>
                  </td>
                  <td className="hidden py-3 pr-4 align-baseline text-sm tabular-nums text-muted-foreground md:table-cell">
                    {fmtDate(it.ts)}
                  </td>
                  <td className="py-3 text-right align-baseline text-sm tabular-nums text-foreground">
                    {fmtSigned(it.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
