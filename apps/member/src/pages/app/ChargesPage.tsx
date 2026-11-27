import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Btn, CBar, CFoot, CHead, CMain, Cell, Chip, Line, Rows, SecHead } from '@/components/clear/brand/anatomy';
import { ChevronIcon, FilterIcon, PlusIcon, SearchIcon, SortIcon } from '@/components/clear/brand/icons';
import MenuButton from '@/components/clear/brand/MenuButton';
import { useSetMobileAction } from '@/components/shell/MobileAction';
import { money } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { REVERSED_ROW } from '@/lib/clearModel';
import {
  CHARGE_FILTERS,
  CHARGE_SORTS,
  chargeLabel,
  chargeState,
  groupChargesByDay,
  notCharged,
  viewCharges,
  waitingSummary,
  type ChargeFilter,
  type ChargeSort,
} from '@/lib/memberCharges';
import type { MemberCharge } from '@/utils/apiClient';
import { cn } from '@/lib/utils';

/** How many the list opens with, and how many Show older adds. */
const PAGE = 12;

/**
 * Shop charges: every charge a shop has sent the member, whatever became of it.
 *
 * The alert is one way to a charge, and it doesn't last: cleared, the app closed, the phone back in
 * a pocket at the counter. This is the other: the ones waiting on them lead, and each row opens the
 * charge itself, to approve it or to see what became of it. Laid out like Activity: the hero says
 * what's waiting, then one full-width list with search, a filter and a sort in its control bar.
 */
export default function ChargesPage({ charges, loading }: { charges: MemberCharge[]; loading?: boolean }) {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ChargeFilter>('all');
  const [sort, setSort] = useState<ChargeSort>('newest');
  const [limit, setLimit] = useState(PAGE);

  useSetMobileAction({ label: 'Scan', icon: PlusIcon, onSelect: () => navigate('/scan') });

  const waiting = waitingSummary(charges);
  const matching = viewCharges(charges, { query, filter, sort });
  const shown = matching.slice(0, limit);
  const narrowed = query.trim() !== '' || filter !== 'all';

  const hero = (
    <div className="mb-s3">
      <p className="c-label mb-s1">Waiting on you</p>
      <p className="c-fig text-hero-m leading-[1.05] lg:text-hero">{money(waiting.cents / 100, { cents: true })}</p>
      <p className="c-keyline">
        {waiting.count === 0 ? (
          'Nothing to answer. A shop’s charge waits here until you approve or decline it.'
        ) : (
          <>
            <strong>{waiting.count}</strong> {waiting.count === 1 ? 'charge' : 'charges'} to answer
            <span className="c-sep">&middot;</span>
            nothing is taken until you approve
          </>
        )}
      </p>
    </div>
  );

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
        placeholder="Search shop or amount"
        aria-label="Search shop charges"
      />
    </label>
  );
  const buttons = (
    <span className="c-ctlgroup">
      <MenuButton
        label={CHARGE_FILTERS.find((f) => f.id === filter)!.label}
        icon={<FilterIcon />}
        options={CHARGE_FILTERS}
        value={filter}
        onChange={(f) => {
          setFilter(f);
          setLimit(PAGE);
        }}
      />
      <MenuButton label={CHARGE_SORTS.find((s) => s.id === sort)!.label} icon={<SortIcon />} options={CHARGE_SORTS} value={sort} onChange={setSort} align="end" />
    </span>
  );

  const tag = (c: MemberCharge) => {
    const s = chargeState(c);
    return (
      <span className={cn('c-det', notCharged(c) || s === 'refunded' ? REVERSED_ROW.text : s === 'waiting' || s === 'paying' ? 'c-t-und' : undefined)}>
        {chargeLabel(c)}
      </span>
    );
  };
  const amount = (c: MemberCharge) => {
    const s = chargeState(c);
    return (
      <span
        className={cn(
          'c-fig c-fig-row',
          notCharged(c) || s === 'refunded' ? REVERSED_ROW.amount : (s === 'waiting' || s === 'paying') && 'c-muted',
          desktop && 'text-right',
        )}
      >
        {money(c.amountCents / 100, { cents: true })}
      </span>
    );
  };
  const chip = (c: MemberCharge) => {
    const s = chargeState(c);
    return s === 'waiting' ? <Chip tone="underway">Waiting</Chip> : s === 'paying' ? <Chip tone="underway">Paying</Chip> : null;
  };

  const empty =
    charges.length === 0 ? (
      <CMain>
        <p className="c-det">
          {loading ? 'Reading your charges…' : 'No shop charges yet. When a shop charges you at the counter, it shows here, whatever you decide.'}
        </p>
      </CMain>
    ) : (
      <CMain>
        <div className="py-s4 text-center">
          <p className="c-fig c-fig-sec">Nothing matches{query.trim() ? ` ${query.trim()}` : ' this filter'}</p>
          <div className="c-pair mx-auto mt-s3 max-w-[280px]">
            <Btn
              onClick={() => {
                setFilter('all');
                setQuery('');
              }}
            >
              Show all charges
            </Btn>
          </div>
        </div>
      </CMain>
    );

  const list = (
    <Cell full>
      <CHead>
        <SecHead label="Shop charges">
          <span className="c-det">
            {narrowed ? `${matching.length} ${matching.length === 1 ? 'result' : 'results'}` : `${charges.length} in all`}
          </span>
        </SecHead>
      </CHead>
      {charges.length > 0 && (
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
        : groupChargesByDay(shown).map((group, i) => (
            <CMain key={`${group.day}-${i}`}>
              <p className="c-grouplabel">{group.day}</p>
              <Rows>
                {group.charges.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => navigate(`/c/${c.code}`)}
                    className="block w-full text-left"
                    aria-label={`${c.merchantName}, ${money(c.amountCents / 100, { cents: true })}, ${chargeLabel(c)}`}
                  >
                    {desktop ? (
                      <div className="grid grid-cols-[1fr_200px_130px] items-center">
                        <span className={cn('text-sec', notCharged(c) && REVERSED_ROW.text)}>{c.merchantName}</span>
                        <span className="c-det">
                          {tag(c)}
                          {chip(c) && <span className="ml-s1">{chip(c)}</span>}
                        </span>
                        {amount(c)}
                      </div>
                    ) : (
                      <Line>
                        <div className="min-w-0">
                          <p className={cn('text-sec', notCharged(c) && REVERSED_ROW.text)}>{c.merchantName}</p>
                          <p className="mt-[2px]">{tag(c)}</p>
                        </div>
                        <span className="flex shrink-0 items-center gap-s1">
                          {chip(c)}
                          {amount(c)}
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
              {shown.length} of {matching.length}
              {waiting.count > 0 && ' · tap one to answer it'}
            </span>
            {matching.length > shown.length && (
              <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="c-det inline-flex! items-center gap-1 hover:text-ink">
                Show older
                <ChevronIcon />
              </button>
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
        <div className={cn('c-slab', !desktop && 'c-one')}>{list}</div>
      </div>
    </>
  );
}
