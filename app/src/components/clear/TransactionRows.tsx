import { signedMoney } from '@/lib/money';
import type { ActivityRow } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Flat transaction rows — name over a "date · source" sub-line, amount right.
 *
 * Used by Home's recent-activity card and by the Card page. Distinct from
 * ActivityList, which groups under date headers and gives the source its own
 * column on desktop; these lists are short enough that grouping would be noise.
 */
export default function TransactionRows({
  rows,
  emptyMessage,
}: {
  rows: ActivityRow[];
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div>
      {rows.map((row, i) => (
        <div
          key={row.id}
          className={cn(
            'flex items-center justify-between gap-3 py-2.5 text-[13px]',
            i < rows.length - 1 && 'border-b-[0.5px] border-border',
          )}
        >
          <div className="min-w-0">
            <p className="truncate">{row.name}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {row.date} · {row.source}
            </p>
          </div>
          <span className={cn('shrink-0 tabular-nums', row.amount > 0 && 'text-tier-savings-fg')}>
            {signedMoney(row.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}
