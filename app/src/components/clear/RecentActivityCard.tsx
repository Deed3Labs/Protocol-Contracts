import { Link } from 'react-router-dom';
import Card from './Card';
import { signedMoney } from '@/lib/money';
import type { ActivityRow } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Recent activity on Home — design spec §4: three rows and a way through to the
 * full Activity page. On mobile "See all" is the only route to Activity, which
 * isn't in the tab bar.
 *
 * Every row carries its source tag (spec §8). Credits are positive and take the
 * success color; debits stay in the primary text color.
 */
export default function RecentActivityCard({ rows }: { rows: ActivityRow[] }) {
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Recent activity</span>
        <Link to="/activity" className="text-xs text-tier-boost-fg hover:underline">
          See all
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">Nothing yet — your spending will show up here.</p>
      ) : (
        <div className="mt-0.5">
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
      )}
    </Card>
  );
}
