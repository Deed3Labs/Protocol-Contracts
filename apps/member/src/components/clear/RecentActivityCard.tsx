import { Link } from 'react-router-dom';
import { CHead, CMain, Cell, Line, Rows, SecHead } from './brand/anatomy';
import { ChevronIcon } from './brand/icons';
import { signedMoney } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { REVERSED_ROW, type ActivityRow } from '@/lib/clearModel';
import { rowTag } from '@/lib/activityView';
import { cn } from '@/lib/utils';

/** The source tag's colour: the tier that paid, or savings, or nothing. */
/**
 * Recent activity — the full-width cell at the bottom of Home's slab. A growing list always goes full
 * width at the bottom, never in a column beside something short.
 *
 * Desktop gives the source its own column; the phone drops it under the name. Five rows on desktop,
 * three on a phone, where the point of the cell is the way through to Activity, not the list.
 */
export default function RecentActivityCard({
  rows,
  onSelect,
}: {
  rows: ActivityRow[];
  onSelect?: (row: ActivityRow) => void;
}) {
  const desktop = useIsDesktop();
  const shown = desktop ? rows.slice(0, 5) : rows.slice(0, 3);

  return (
    <Cell full>
      <CHead>
        <SecHead label="Recent activity">
          <Link to="/activity" className="c-det inline-flex! items-center gap-1 hover:text-ink">
            See all
            <ChevronIcon />
          </Link>
        </SecHead>
      </CHead>
      <CMain>
        {shown.length === 0 ? (
          <p className="c-det">Nothing yet — your spending will show up here.</p>
        ) : (
          <Rows>
            {shown.map((row) => {
              const tag = rowTag(row);
              // A charge that was given back reads the same here as on the Card and Activity pages.
              const label = row.reversed ? REVERSED_ROW.label : tag.label;
              const labelClass = row.reversed ? REVERSED_ROW.text : tag.className;
              const amount = (
                <span
                  className={cn(
                    'c-fig c-fig-row',
                    row.reversed ? REVERSED_ROW.amount : row.amount > 0 && 'c-pos',
                    desktop && 'text-right',
                  )}
                >
                  {signedMoney(row.amount)}
                </span>
              );
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onSelect?.(row)}
                  className="block w-full text-left"
                >
                  {desktop ? (
                    <div className="grid grid-cols-[1fr_150px_110px] items-center">
                      <span className={cn('text-sec', row.reversed && REVERSED_ROW.text)}>{row.name}</span>
                      <span className={cn('c-det', labelClass)}>{label}</span>
                      {amount}
                    </div>
                  ) : (
                    <Line>
                      <div>
                        <p className={cn('text-sec', row.reversed && REVERSED_ROW.text)}>{row.name}</p>
                        <p className={cn('c-det', labelClass)}>{label}</p>
                      </div>
                      {amount}
                    </Line>
                  )}
                </button>
              );
            })}
          </Rows>
        )}
      </CMain>
    </Cell>
  );
}
