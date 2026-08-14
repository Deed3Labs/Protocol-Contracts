import { signedMoney } from '@/lib/money';
import { groupByDate, shortDate, sourceTag, type ActivityRow } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Grouped activity list — design spec §8.
 *
 * Structurally different across breakpoints, not just narrower: desktop is a
 * three-column grid (name | source | amount), mobile drops the source to a
 * sub-line under the name. Every row carries its source tag either way.
 *
 * Money in is positive and takes the success color; money out stays in the
 * primary text color, so spending doesn't read as an error.
 */
export default function ActivityList({
  rows,
  onSelect,
}: {
  rows: ActivityRow[];
  onSelect?: (row: ActivityRow) => void;
}) {
  const groups = groupByDate(rows);

  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        Nothing here yet — activity will appear as you spend, deposit and save.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.date}>
          <p className="mb-1 text-[11px] text-muted-foreground">
            <span className="lg:hidden">{shortDate(group.date)}</span>
            <span className="hidden lg:inline">{group.date}</span>
          </p>

          <div className="text-[13px]">
            {group.rows.map((row, i) => {
              const tag = sourceTag(row);

              return (
              <button
                key={row.id}
                type="button"
                onClick={() => onSelect?.(row)}
                className={cn(
                  'grid w-full grid-cols-[1fr_auto] items-center gap-3 py-2.5 text-left transition-colors lg:grid-cols-[1fr_130px_100px]',
                  onSelect && 'hover:bg-secondary/60',
                  i < group.rows.length - 1 && 'border-b-[0.5px] border-border',
                )}
              >
                <div className="min-w-0">
                  <p className="truncate">{row.name}</p>
                  {/* Source moves to a sub-line below lg, where there's no column for it */}
                  <p className="mt-0.5 text-[11px] text-muted-foreground lg:hidden">{row.source}</p>
                </div>

                {/* Desktop names the tier that funded it — which tier paid is
                    what sets the rate, and the list is the only place it shows. */}
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
        </div>
      ))}
    </div>
  );
}
