import { useContext, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { seesMoney } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { OneColumn } from '@/brand/ui';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import { firstName } from '@/home/model';
import {
  filterRows,
  LATE_ROWS,
  raisedToday,
  REFERENCE_ROWS,
  rowFromApi,
  sortRows,
  TEAM_NAMES,
  type ChargeRow,
  type Filters,
  type SortBy,
} from '@/charges/model';
import { ChargesList, HowPaidPanel, RaisedTodayPanel } from '@/charges/views';

/**
 * Charges — docs/merchant-reference/clear-merchant-charges.html.
 *
 * The list a writer opens to answer two questions: who has not confirmed, and what did we run.
 * Raised today sits above it, with How it was paid beside it on a landscape tablet. A counter
 * shift sees its own there, and today and yesterday in the list.
 *
 * A live shop's rows are its Clear charges from the API. Card, cash and split have no backend yet,
 * so the preview shows them: `?preview=1&screen=owner|late|counter|menu-filter|menu-sort` (and
 * `&as=jen` for a counter shift's header).
 */
export default function ChargesPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { session } = useAuth();
  const one = useContext(OneColumn);

  const preview = import.meta.env.DEV && params.get('preview') === '1' && params.get('live') !== '1';
  const screen = preview ? (params.get('screen') ?? 'owner') : '';
  const role = screen === 'counter' ? 'counter' : (session?.staff.role ?? 'counter');
  const owner = seesMoney(role);
  const me = screen === 'counter' ? 'Jen' : firstName(session?.staff.name ?? '');
  const myId = screen === 'counter' ? 'jen' : session?.staff.id;

  const { data } = useApi(() => (preview ? Promise.resolve(null) : api.charges({ limit: 200 })), [preview]);
  const all: ChargeRow[] = useMemo(
    () => (preview ? (screen === 'late' ? LATE_ROWS : REFERENCE_ROWS) : (data ?? []).map((c) => rowFromApi(c))),
    [preview, screen, data],
  );

  const [filters, setFilters] = useState<Filters>({ when: owner ? 'month' : 'both', status: 'all', method: 'any', by: 'anyone' });
  const [sort, setSort] = useState<SortBy>('newest');
  const rows = sortRows(filterRows(all, filters), sort);

  // A counter shift's panels are its own charges; the list is the shop's.
  const mine = owner ? all : all.filter((r) => r.byId === myId);
  const t = raisedToday(mine);
  const people = preview ? TEAM_NAMES : [...new Set(all.map((r) => r.by).filter((b) => b !== '—'))];
  // The dev preview's own parameters travel with it: the reference frames' counter view, and on the
  // live path `live` and who's on shift, so opening a charge stays on the mock.
  const q = preview
    ? `?preview=1${screen === 'counter' ? '&screen=counter' : ''}`
    : import.meta.env.DEV && params.get('preview') === '1'
      ? `?preview=1&live=1${params.get('as') ? `&as=${params.get('as')}` : ''}`
      : '';

  return (
    <>
      {one ? (
        <div className="c-mc-slot">
          <RaisedTodayPanel t={t} you={!owner} />
        </div>
      ) : (
        <div className="c-mc-slot c-sa-row">
          <RaisedTodayPanel t={t} you={!owner} />
          <HowPaidPanel rows={mine} you={!owner} />
        </div>
      )}
      {/* One column at every width: the list is one list. */}
      <div className="c-slab c-one">
        <ChargesList
          rows={rows}
          all={all}
          filters={filters}
          sort={sort}
          owner={owner}
          people={people.length ? people : [me]}
          onFilters={setFilters}
          onSort={setSort}
          onOpen={(r) => navigate(`/charges/${r.id}${q}`)}
          menuOpen={screen === 'menu-filter' ? 'filter' : screen === 'menu-sort' ? 'sort' : undefined}
        />
      </div>
    </>
  );
}
