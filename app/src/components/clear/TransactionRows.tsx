import { signedMoney } from '@/lib/money';
import { sourceTag, type ActivityRow } from '@/lib/clearModel';
import { cn } from '@/lib/utils';
import TransactionAvatar from './TransactionAvatar';

/**
 * Flat transaction rows — used by Home's recent-activity card and by the Card
 * page. Distinct from ActivityList, which groups under date headers; these lists
 * are short enough that grouping would be noise.
 *
 * Both layouts name the tier that funded each row — which tier paid is what sets
 * the rate, and a list is the only place it shows. Desktop gives it a column;
 * mobile drops it to a sub-line under the name.
 */

export default function TransactionRows({
  rows,
  emptyMessage,
  onSelect,
  /** Prefix the mobile sub-line with the date. Off for short "recent" lists,
      where every row is from the last few days anyway. */
  showDate,
}: {
  rows: ActivityRow[];
  emptyMessage: string;
  onSelect?: (row: ActivityRow) => void;
  showDate?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div>
      {rows.map((row, i) => {
        const tag = sourceTag(row);

        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect?.(row)}
            className={cn(
              'grid w-full grid-cols-[1fr_auto] items-center gap-3 py-2.5 text-left text-[13px] transition-colors lg:grid-cols-[1fr_130px_100px]',
              onSelect && 'hover:bg-secondary/60',
              i < rows.length - 1 && 'border-b-[0.5px] border-border',
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              {/*
                * Tinted by category, so the list is scannable by colour before it is scannable by
                * name — and it makes the summary bar above and the rows below the same argument.
                */}
              <TransactionAvatar row={row} />
              <div className="min-w-0">
                <p className="truncate">{row.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground lg:hidden">
                  {showDate && `${row.date} · `}
                  {tag.label}
                </p>
              </div>
            </div>

            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex">
              {tag.dot && (
                <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tag.dot)} />
              )}
              {tag.label}
            </span>

            <span
              className={cn(
                'shrink-0 text-right tabular-nums',
                row.amount > 0 && 'text-tier-savings-fg',
              )}
            >
              {signedMoney(row.amount)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
