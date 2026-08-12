import { Link } from 'react-router-dom';
import Card from './Card';
import TransactionRows from './TransactionRows';
import type { ActivityRow } from '@/lib/clearModel';

/**
 * Recent activity on Home — design spec §4: three rows and a way through to the
 * full Activity page. On mobile "See all" is the only route to Activity, which
 * isn't in the tab bar.
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

      <div className="mt-0.5">
        <TransactionRows
          rows={rows}
          emptyMessage="Nothing yet — your spending will show up here."
        />
      </div>
    </Card>
  );
}
