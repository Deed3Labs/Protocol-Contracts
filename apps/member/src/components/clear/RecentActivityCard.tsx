import { Link } from 'react-router-dom';
import { CHead, CMain, Cell, Line, Rows, SecHead } from './brand/anatomy';
import { ChevronIcon } from './brand/icons';
import { TIER_TEXT_CLASS } from './ClearCreditCard';
import { signedMoney } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { sourceTag, type ActivityRow } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** The source tag's colour: the tier that paid, or savings, or nothing. */
function tagClass(row: ActivityRow) {
  if (row.paidFromTier) return TIER_TEXT_CLASS[row.paidFromTier];
  if (row.source === 'savings') return 'c-t-sav';
  return undefined;
}

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
              const tag = sourceTag(row);
              const amount = (
                <span className={cn('c-fig c-fig-row', row.amount > 0 && 'c-pos', desktop && 'text-right')}>
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
                      <span className="text-sec">{row.name}</span>
                      <span className={cn('c-det', tagClass(row))}>{tag.label}</span>
                      {amount}
                    </div>
                  ) : (
                    <Line>
                      <div>
                        <p className="text-sec">{row.name}</p>
                        <p className={cn('c-det', tagClass(row))}>{tag.label}</p>
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
