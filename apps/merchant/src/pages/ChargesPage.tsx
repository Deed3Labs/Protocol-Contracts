import { useContext, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { seesMoney } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { OneColumn } from '@/brand/ui';
import { api } from '@/data/apiClient';
import { useMerchantApi } from '@/data/merchantApi';
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
  rowFromOrder,
} from '@/charges/model';
import { ChargesList, HowPaidPanel, RaisedTodayPanel } from '@/charges/views';

/**
 * Charges — docs/merchant-reference/clear-merchant-charges.html.
 *
 * The list a writer opens to answer two questions: who has not confirmed, and what did we run.
 * Raised today sits above it, with How it was paid beside it on a landscape tablet. A counter
 * shift sees its own there, and today and yesterday in the list.
 *
 * A live shop's rows are its Clear charges, and its card, cash and split sales from the order
 * history (the month so far): a sale's Clear part is its own Clear row, so each dollar is listed
 * once. The preview shows the reference: `?preview=1&screen=owner|late|counter|menu-filter|
 * menu-sort` (and `&as=jen` for a counter shift's header); `&live=1` for the live path.
 */
/** The month so far, and yesterday on the 1st: every range the list's filters can ask for. */
function historyRange(now = new Date()) {
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return { from: day(yesterday < first ? yesterday : first), to: day(now) };
}

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
  // Card, cash and split sales: the orders over the month so far (and yesterday, on the 1st).
  const merchant = useMerchantApi();
  const sales = useApi(() => (preview ? Promise.resolve(null) : merchant.orderHistory(historyRange())), [preview]);
  const roster = useApi(() => (preview ? Promise.resolve(null) : api.roster()), [preview]);
  const all: ChargeRow[] = useMemo(() => {
    if (preview) return screen === 'late' ? LATE_ROWS : REFERENCE_ROWS;
    const nameOf = (id: string) => roster.data?.find((p) => p.id === id)?.name ?? '—';
    const clear = (data ?? []).map((c) => rowFromApi(c));
    const sold = (sales.data ?? []).flatMap((o) => rowFromOrder(o, nameOf) ?? []);
    return [...clear, ...sold];
  }, [preview, screen, data, sales.data, roster.data]);

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
