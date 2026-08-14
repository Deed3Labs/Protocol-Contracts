import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Card from '@/components/clear/Card';
import FilterChips from '@/components/clear/FilterChips';
import PendingClaimBanner from '@/components/clear/PendingClaimBanner';
import ActivityList from '@/components/clear/ActivityList';
import CycleSpendCard from '@/components/clear/CycleSpendCard';
import TransactionDetailDialog from '@/components/clear/TransactionDetailDialog';
import { ACTIVITY_IN_USE } from '@/data/clearPlaceholder';
import { money } from '@/lib/money';
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
 * The two layouts ask different questions. Desktop has room to answer "where did
 * the cycle go", so it carries a rail: what was spent and out of which pocket,
 * what it went on, and how much of it stayed inside the co-op. Mobile answers
 * "what happened" — chips and the list, nothing else, because the cycle total
 * already leads Home.
 *
 * Reached from the tab bar on desktop and from "See all" on Home on mobile,
 * where six tabs wouldn't fit the pill.
 */
export default function ActivityPage({ data = ACTIVITY_IN_USE }: { data?: ActivityData }) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ActivityRow | null>(null);

  const term = query.trim().toLowerCase();
  const rows = filterActivity(data.rows, filter).filter(
    (r) => term === '' || r.name.toLowerCase().includes(term) || String(Math.abs(r.amount)).includes(term),
  );

  const list = (
    <>
      {data.pendingClaim && (
        <div className="mb-4">
          <PendingClaimBanner claim={data.pendingClaim} />
        </div>
      )}

      {/* An empty result from a filter is a different message than an empty account */}
      {rows.length === 0 && data.rows.length > 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          Nothing matches — try a different filter or search.
        </p>
      ) : (
        <ActivityList rows={rows} onSelect={setSelected} />
      )}
    </>
  );

  /**
   * Where the cycle went. A side rail on desktop; on a phone the same three cards
   * sit above the list, because the summary is what most visits are actually for
   * and scrolling past every transaction to reach it is the wrong order.
   */
  const summary = (
    <div className="flex flex-col gap-3">
      {data.cycleSpend && <CycleSpendCard cycle={data.cycleSpend} />}

      {data.categories && data.categories.length > 0 && (
        <Card>
          <p className="mb-1 text-xs text-foreground-secondary">Where it went</p>
          <div className="text-xs text-muted-foreground">
            {data.categories.map((c) => (
              <div key={c.label} className="flex items-baseline justify-between gap-3 leading-[1.9]">
                <span className="truncate">{c.label}</span>
                <span className="tabular-nums">{money(c.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.insideCoop !== undefined && data.cycleSpend && (
        <Card>
          <p className="mb-1 text-xs text-foreground-secondary">Inside the co-op</p>
          <p className="font-display text-[26px] font-medium leading-none text-tier-savings-fg">
            {money(data.insideCoop)}
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            of {money(data.cycleSpend.spent)} stayed with members and Clear Partners this cycle.
          </p>
        </Card>
      )}
    </div>
  );

  const chips = (trailing?: ReactNode) => (
    <FilterChips
      options={ACTIVITY_FILTERS}
      value={filter}
      onChange={setFilter}
      trailing={trailing}
    />
  );

  const exportButton = (
    <Button variant="clear" size="xs" className="shrink-0">
      Export
    </Button>
  );

  return (
    <>
      {/* Mobile: filters, then the cycle summary, then the list */}
      <div className="lg:hidden">
        <div className="mb-4">{chips(exportButton)}</div>
        <div className="mb-4">{summary}</div>
        {list}
      </div>

      <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6">
        <div>
          <div className="mb-4 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search merchant or amount"
                aria-label="Search activity"
                className="h-9 pl-8 text-xs"
              />
            </div>
            <Button
              variant="clear"
              size="xs"
              aria-pressed={showFilters}
              onClick={() => setShowFilters((v) => !v)}
              className={showFilters ? 'border-tier-boost text-tier-boost-fg' : undefined}
            >
              Filters
            </Button>
            {exportButton}
          </div>

          {/* Filters open as a strip rather than a menu: there are five of them and
              the selected one has to stay visible while you read the list. */}
          {showFilters && <div className="mb-4">{chips()}</div>}

          {list}
        </div>

        {summary}
      </div>

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
