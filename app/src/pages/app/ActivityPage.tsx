import { useState } from 'react';
import FilterChips from '@/components/clear/FilterChips';
import PendingClaimBanner from '@/components/clear/PendingClaimBanner';
import ActivityList from '@/components/clear/ActivityList';
import TransactionDetailDialog from '@/components/clear/TransactionDetailDialog';
import { ACTIVITY_IN_USE } from '@/data/clearPlaceholder';
import { signedMoney } from '@/lib/money';
import {
  ACTIVITY_FILTERS,
  type ActivityRow,
  filterActivity,
  type ActivityData,
  type ActivityFilter,
} from '@/lib/clearModel';

/**
 * Activity — design spec §8. Everything that moved, unlike the Card page, which
 * shows card transactions only.
 *
 * Reached from the tab bar on desktop and from "See all" on Home on mobile,
 * where six tabs wouldn't fit the pill.
 */
export default function ActivityPage({ data = ACTIVITY_IN_USE }: { data?: ActivityData }) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [selected, setSelected] = useState<ActivityRow | null>(null);
  const rows = filterActivity(data.rows, filter);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <FilterChips options={ACTIVITY_FILTERS} value={filter} onChange={setFilter} />
        {/* Desktop only: on a phone the cycle total already leads the Home page,
            and repeating it here costs a row above the list. */}
        {data.rows.length > 0 && (
          <span className="hidden shrink-0 text-xs text-foreground-secondary lg:inline">
            This cycle:{' '}
            <span className="text-foreground">{signedMoney(data.cycleNet, { cents: false })}</span>
          </span>
        )}
      </div>

      {data.pendingClaim && (
        <div className="mb-4">
          <PendingClaimBanner claim={data.pendingClaim} />
        </div>
      )}

      {/* An empty result from a filter is a different message than an empty account */}
      {rows.length === 0 && data.rows.length > 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          Nothing in this filter for the current cycle.
        </p>
      ) : (
        <ActivityList rows={rows} onSelect={setSelected} />
      )}

      {selected && (
        <TransactionDetailDialog
          row={selected}
          open={selected !== null}
          onOpenChange={(o) => !o && setSelected(null)}
        />
      )}
    </>
  );
}
