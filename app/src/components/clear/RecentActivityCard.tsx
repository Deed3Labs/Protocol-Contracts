import { Link } from 'react-router-dom';
import Card from './Card';
import TransactionRows from './TransactionRows';
import { useIsDesktop } from '@/lib/useIsDesktop';
import type { ActivityRow } from '@/lib/clearModel';

/**
 * Recent activity on Home — design spec §4, and a way through to the full
 * Activity page. On mobile "See all" is the only route to Activity, which isn't
 * in the tab bar.
 *
 * Five rows on desktop, three on a phone: the card sits at the bottom of a long
 * scroll there, and the point of it is the way through, not the list.
 */
export default function RecentActivityCard({
  rows,
  onSelect,
}: {
  rows: ActivityRow[];
  onSelect?: (row: ActivityRow) => void;
}) {
  const isDesktop = useIsDesktop();

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Recent activity</span>
        <Link to="/activity" className="text-xs text-tier-boost-fg hover:underline">
          See all
        </Link>
      </div>

      <div className="mt-0.5">
        <TransactionRows
          onSelect={onSelect}
          rows={isDesktop ? rows : rows.slice(0, 3)}
          emptyMessage="Nothing yet — your spending will show up here."
        />
      </div>
    </Card>
  );
}
