import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, Btn, CBar, CFoot, CHead, CMain, Cell, Chip, Line, Rows, SecHead } from '@/components/clear/brand/anatomy';
import { ChevronIcon, FilterIcon, PlusIcon, SearchIcon, SortIcon } from '@/components/clear/brand/icons';
import MenuButton from '@/components/clear/brand/MenuButton';
import { useSetMobileAction } from '@/components/shell/MobileAction';
import PendingClaimBanner from '@/components/clear/PendingClaimBanner';
import TransactionDetailDialog from '@/components/clear/TransactionDetailDialog';
import FiltersDialog from '@/components/clear/activity/FiltersDialog';
import ExportDialog from '@/components/clear/activity/ExportDialog';
import { ACTIVITY_DAY_ONE } from '@/data/clearPlaceholder';
import { money, signedMoney } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import {
  ACTIVITY_SORTS,
  DEFAULT_FILTERS,
  PAID_FROM,
  WHEN,
  categoryShares,
  filterRows,
  groupByDay,
  rowTag,
  sortRows,
  type ActivityFilters,
  type ActivitySort,
} from '@/lib/activityView';
import type { ActivityData, ActivityRow } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** How many rows the list opens with, and how many Show older adds. */
const PAGE = 8;

/** A header or footer link: detail text with a chevron. */
function MoreLink({ to, onClick, children }: { to?: string; onClick?: () => void; children: string }) {
  const className = 'c-det inline-flex! items-center gap-1 hover:text-ink';
  const inner = (
    <>
      {children}
      <ChevronIcon />
    </>
  );
  return to ? (
    <Link to={to} className={className}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

/**
 * Activity — everything that moved, unlike Card, which shows card transactions only.
 *
 * Hero, temporary slot, then the standing cells with the growing list full width at the bottom —
 * the same arrangement as Card, Home and Earn. The hero states what the cycle was made of: from
 * cash, from credit and the carry, on one bar. Search, filters, sort and export sit in the list's
 * control bar, because they act on the list and nothing else. Days are sections, and pending is a
 * state: a chip and a quiet amount.
 */
export default function ActivityPage({ data = ACTIVITY_DAY_ONE, email }: { data?: ActivityData; email?: string }) {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<ActivitySort>('newest');
  const [limit, setLimit] = useState(PAGE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [selected, setSelected] = useState<ActivityRow | null>(null);

  useSetMobileAction({ label: 'Scan', icon: PlusIcon, onSelect: () => navigate('/scan') });

  const cycle = data.cycleSpend;
  const matching = sortRows(filterRows(data.rows, filters, query), sort);
  const shown = matching.slice(0, limit);
  const narrowed = query.trim() !== '' || filters.direction !== 'all' || filters.paidFrom !== 'any';
  const total = narrowed ? matching.length : (data.cycleCount ?? data.rows.length);
  const anyPending = shown.some((r) => r.pending);

  // ---- Hero ---------------------------------------------------------------------------------------

  const hero = cycle && (
    <div className="mb-s3">
      <p className="c-label mb-s1">Spent this cycle</p>
      <p className="c-fig text-hero-m leading-[1.05] lg:text-hero">{money(cycle.spent, { cents: true })}</p>
      <Bar
        className="mt-s2"
        label={`Spent this cycle: ${money(cycle.fromCash, { cents: true })} from cash, ${money(cycle.fromCredit, { cents: true })} from credit`}
        segments={[
          { label: 'From cash', pct: cycle.spent > 0 ? (cycle.fromCash / cycle.spent) * 100 : 0, color: 'var(--vest-cash)' },
          { label: 'From credit', pct: cycle.spent > 0 ? (cycle.fromCredit / cycle.spent) * 100 : 0, color: 'var(--tier-asset)' },
        ]}
      />
      <p className="c-keyline">
        From cash <strong>{money(cycle.fromCash, { cents: true })}</strong>
        <span className="c-sep">&middot;</span>
        <span className="c-t-ast">From credit</span> <strong>{money(cycle.fromCredit, { cents: true })}</strong>
        <span className="c-sep">&middot;</span>
        carry <strong>{money(cycle.carryCost, { cents: true })}</strong>
      </p>
    </div>
  );

  // ---- Standing cells -----------------------------------------------------------------------------

  const shares = cycle && data.categories?.length ? categoryShares(data.categories, cycle.spent) : [];
  const whereItWent = shares.length > 0 && (
    <Cell>
      <CHead>
        <SecHead label="Where it went">
          <span className="c-det">{shares.length} groups</span>
        </SecHead>
      </CHead>
      <CMain>
        <Rows>
          {shares.map((group) => (
            <div key={group.label}>
              <Line>
                <span className="text-sec">{group.label}</span>
                <span className="c-fig c-fig-row">{money(group.amount, { cents: true })}</span>
              </Line>
              <p className="c-det mt-[3px]">{group.pct}% of this cycle</p>
            </div>
          ))}
        </Rows>
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">Grouped automatically</span>
          <MoreLink onClick={() => {}}>Change groups</MoreLink>
        </Line>
      </CFoot>
    </Cell>
  );

  const insideCoop = data.insideCoop !== undefined && cycle && (
    <Cell>
      <CHead>
        <SecHead label="Inside the co-op">
          <p className="c-fig c-fig-sec">{money(data.insideCoop, { cents: true })}</p>
        </SecHead>
      </CHead>
      <CMain>
        <p className="c-det">
          Of {money(cycle.spent, { cents: true })} spent this cycle, this much stayed with members and Clear Partners rather
          than leaving the network.
        </p>
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">
            {data.insideCoopPayments ?? 0} {data.insideCoopPayments === 1 ? 'payment' : 'payments'}
          </span>
          <MoreLink to="/partners">Find partners</MoreLink>
        </Line>
      </CFoot>
    </Cell>
  );

  // ---- The list -----------------------------------------------------------------------------------

  const search = (
    <label className="c-searchfield">
      <span className="c-ic">
        <SearchIcon />
      </span>
      <input
        className="c-field c-bare"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(PAGE);
        }}
        placeholder="Search merchant or amount"
        aria-label="Search activity"
      />
    </label>
  );
  const narrowedCount = Number(filters.direction !== 'all') + Number(filters.paidFrom !== 'any');
  const buttons = (
    <>
      {/* What narrows the list travels together; Export, which takes it elsewhere, sits apart. */}
      <span className="c-ctlgroup">
      <Btn onClick={() => setFiltersOpen(true)} aria-label={narrowedCount ? `Filters, ${narrowedCount} on` : 'Filters'}>
        <FilterIcon />
        {narrowedCount ? `Filters · ${narrowedCount}` : 'Filters'}
      </Btn>
      <MenuButton
        label={ACTIVITY_SORTS.find((s) => s.id === sort)!.label}
        icon={<SortIcon />}
        options={ACTIVITY_SORTS}
        value={sort}
        onChange={setSort}
        align="end"
      />
      </span>
      <Btn className="c-linkish" onClick={() => setExportOpen(true)}>
        Export
      </Btn>
    </>
  );

  const tag = (row: ActivityRow) => {
    const t = rowTag(row);
    return <span className={cn('c-det', t.className)}>{t.label}</span>;
  };
  const amount = (row: ActivityRow) => (
    <span className={cn('c-fig c-fig-row', row.pending ? 'c-muted' : row.amount > 0 && 'c-pos', desktop && 'text-right')}>
      {signedMoney(row.amount)}
    </span>
  );
  const pendingChip = <Chip tone="underway">Pending</Chip>;

  const whenLabel = WHEN.find((w) => w.id === filters.when)!.label;
  const fromLabel =
    filters.paidFrom === 'any' ? 'cash and credit' : PAID_FROM.find((p) => p.id === filters.paidFrom)!.label.toLowerCase();

  const empty =
    data.rows.length === 0 ? (
      <CMain>
        <p className="c-det">Nothing here yet. Activity will appear as you spend, deposit and save.</p>
      </CMain>
    ) : (
      <CMain>
        <div className="py-s4 text-center">
          <p className="c-fig c-fig-sec">
            Nothing matches{query.trim() ? ` ${query.trim()}` : ' these filters'}
          </p>
          <p className="c-det mt-s1">
            In {whenLabel.toLowerCase()}, from {fromLabel}.
          </p>
          <div className="c-pair mx-auto mt-s3 max-w-[280px]">
            <Btn onClick={() => setFilters({ ...filters, when: 'year' })}>Search all time</Btn>
            <Btn
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                setQuery('');
              }}
            >
              Clear filters
            </Btn>
          </div>
        </div>
      </CMain>
    );

  const list = (
    <Cell full>
      <CHead>
        <SecHead label="Activity">
          <span className="c-det">
            {narrowed ? `${matching.length} ${matching.length === 1 ? 'result' : 'results'}` : `${total} this cycle`}
          </span>
        </SecHead>
      </CHead>
      {data.rows.length > 0 && (
        <CBar>
          {desktop ? (
            <div className="c-listctl">
              {search}
              {buttons}
            </div>
          ) : (
            <div className="c-ctlstack">
              {search}
              <div className="c-listctl c-nowrap">{buttons}</div>
            </div>
          )}
        </CBar>
      )}
      {shown.length === 0
        ? empty
        : groupByDay(shown).map((group) => (
            <CMain key={group.day}>
              <p className="c-grouplabel">{group.day}</p>
              <Rows>
                {group.rows.map((row) => (
                  <button key={row.id} type="button" onClick={() => setSelected(row)} className="block w-full text-left">
                    {desktop ? (
                      <div className="grid grid-cols-[1fr_170px_130px] items-center">
                        <span className="text-sec">{row.name}</span>
                        <span className="c-det">
                          {tag(row)}
                          {row.pending && <span className="ml-s1">{pendingChip}</span>}
                        </span>
                        {amount(row)}
                      </div>
                    ) : (
                      <Line>
                        <div className="min-w-0">
                          <p className="text-sec">{row.name}</p>
                          <p className="mt-[2px]">{tag(row)}</p>
                        </div>
                        <span className="flex shrink-0 items-center gap-s1">
                          {row.pending && pendingChip}
                          {amount(row)}
                        </span>
                      </Line>
                    )}
                  </button>
                ))}
              </Rows>
            </CMain>
          ))}
      {shown.length > 0 && (
        <CFoot>
          <Line className="items-center!">
            <span className="c-det">
              {shown.length} of {total}
              {anyPending && ' · pending clears overnight'}
            </span>
            {matching.length > shown.length && (
              <MoreLink onClick={() => setLimit((l) => l + PAGE)}>Show older</MoreLink>
            )}
          </Line>
        </CFoot>
      )}
    </Cell>
  );

  return (
    <>
      {hero}
      <div className="c-home">
        {data.pendingClaim && <PendingClaimBanner claim={data.pendingClaim} showSent />}
        <div className={cn('c-slab', (!desktop || !whereItWent || !insideCoop) && 'c-one')}>
          {whereItWent}
          {insideCoop}
          {list}
        </div>
      </div>

      <FiltersDialog
        rows={data.rows}
        query={query}
        filters={filters}
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        onApply={(next) => {
          setFilters(next);
          setLimit(PAGE);
          setFiltersOpen(false);
        }}
      />
      <ExportDialog
        cycleRows={data.cycleCount ?? data.rows.length}
        allRows={data.totalCount ?? data.rows.length}
        email={email}
        open={exportOpen}
        onOpenChange={setExportOpen}
        onExport={() => setExportOpen(false)}
      />
      {selected && (
        <TransactionDetailDialog row={selected} open={selected !== null} onOpenChange={(o) => !o && setSelected(null)} />
      )}
    </>
  );
}
