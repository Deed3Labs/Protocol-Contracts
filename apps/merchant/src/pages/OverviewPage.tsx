import { useContext, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/authContext';
import { OneColumn } from '@/brand/ui';
import { api } from '@/data/apiClient';
import { useMerchantApi } from '@/data/merchantApi';
import { useApi } from '@/data/useApi';
import { liveMonth } from '@/overview/live';
import { fromApi, REFERENCE, type OverviewModel } from '@/overview/model';
import {
  EodCell,
  ExtrasCell,
  FeesCell,
  ItemsCell,
  MonthCard,
  MonthHero,
  MonthsCell,
  OverviewLocked,
  OwedCell,
  PaidByCell,
  PeopleCell,
  RecentCell,
  StatementsSheet,
  TermsCell,
  TermsSheet,
  TipSlot,
} from '@/overview/views';
import { useLayout } from '@/lib/useBreakpoint';
import { useShiftActions } from '@/shell/shiftActions';

/**
 * Overview — docs/merchant-reference/clear-merchant-overview.html.
 *
 * Everything an owner asks at month end, and nothing a writer needs mid-shift. The same three
 * blocks as Home: the month as the figure, the month as the live component, one insight as the
 * slot, then the slab. It answers and does not manage: every cell links to the page that does.
 *
 * A live shop's month, how it was paid, top items, discounts, tips, tax and the end-of-day reports
 * come from the merchant API (every way it was paid, not Clear alone); card processing from the
 * processor's deposits; Clear's fees, the payout position, terms and roster from the Clear API.
 * The preview: `?preview=1&screen=counter|statements|terms`; `?preview=1&live=1` runs it on the mock.
 */
export default function OverviewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const one = useContext(OneColumn);
  const layout = useLayout();
  const shift = useShiftActions();
  const { session } = useAuth();

  const preview = import.meta.env.DEV && params.get('preview') === '1' && params.get('live') !== '1';
  const screen = preview ? (params.get('screen') ?? '') : '';
  const q = preview ? '?preview=1' : '';

  const { data: charges, loading } = useApi(() => (preview ? Promise.resolve(null) : api.charges({ limit: 300 })), [preview]);
  const { data: position } = useApi(() => (preview ? Promise.resolve(null) : api.payouts()), [preview]);
  const { data: profile } = useApi(() => (preview ? Promise.resolve(null) : api.profile()), [preview]);
  const { data: staff } = useApi(() => (preview ? Promise.resolve(null) : api.staff()), [preview]);
  // The month, and the one before, across Clear, card and cash.
  const merchant = useMerchantApi();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const today = ymd(now);
  const yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const monthRange = { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  const prevRange = { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
  const month = useApi(() => (preview ? Promise.resolve(null) : merchant.overview(monthRange)), [preview]);
  const prevMonth = useApi(() => (preview ? Promise.resolve(null) : merchant.overview(prevRange)), [preview]);
  const deposits = useApi(() => (preview ? Promise.resolve(null) : merchant.cardDeposits(monthRange)), [preview]);
  const recentOrders = useApi(
    () => (preview ? Promise.resolve(null) : Promise.all([merchant.orders({ date: today }), merchant.orders({ date: yesterday })]).then(([a, b]) => [...a, ...b])),
    [preview],
  );
  const roster = useApi(() => (preview ? Promise.resolve(null) : merchant.staff()), [preview]);
  const [open, setOpen] = useState<'statements' | 'terms' | null>(screen === 'statements' || screen === 'terms' ? screen : null);

  const m: OverviewModel | null = useMemo(() => {
    if (preview) return REFERENCE;
    if (loading || month.loading) return null;
    const base = fromApi({ charges: charges ?? [], position, profile, staff });
    if (!month.data) return base;
    const names = new Map([...(staff ?? []), ...(roster.data ?? [])].map((x) => [x.id, x.name]));
    return liveMonth(base, {
      month: month.data,
      prev: prevMonth.data,
      deposits: deposits.data ?? [],
      orders: recentOrders.data ?? [],
      nameOf: (id) => names.get(id) ?? '—',
      today,
      monthName: now.toLocaleDateString('en-US', { month: 'long' }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, loading, charges, position, profile, staff, month.data, month.loading, prevMonth.data, deposits.data, recentOrders.data, roster.data]);

  if (screen === 'counter') return <OverviewLocked name="Jen" onOwner={shift.ownerSignIn} />;
  if (!m || !session) return null;

  const go = (to: string) => () => navigate(`${to}${q}`);
  const recent = <RecentCell m={m} onAll={go('/charges')} />;
  const owed = m.owed && <OwedCell o={m.owed} onPayouts={go('/payouts')} />;
  const fees = <FeesCell m={m} />;
  const months = <MonthsCell m={m} />;
  const terms = (
    <div style={{ display: 'contents' }} onClick={() => setOpen('terms')}>
      <TermsCell m={m} />
    </div>
  );
  const people = <PeopleCell m={m} full={layout !== 'phone'} onStaff={go('/staff')} />;
  const more = m.more;
  const statements = [...m.months].reverse().map((x, i) => ({
    t: new Date(`${x.t.replace(' ', ' 1, ')}`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    det: i === 0 ? `In progress · ${x.det.split(' · ')[0]}` : `Closed · ${x.det}`,
    cents: x.cents,
  }));

  return (
    <>
      <MonthHero m={m} onStatements={() => setOpen('statements')} />
      <MonthCard m={m} />
      {m.tip && <TipSlot tip={m.tip} onPeople={go('/staff')} />}
      {one ? (
        <div className="c-slab c-one">
          {owed}
          {fees}
          {months}
          {recent}
          {terms}
          {people}
          {more && (
            <>
              <PaidByCell more={more} onCharges={go('/charges')} />
              <ItemsCell more={more} onInventory={go('/inventory')} />
              <ExtrasCell more={more} onTax={go('/settings/tax')} />
              <EodCell more={more} onAll={go('/close')} />
            </>
          )}
        </div>
      ) : (
        <>
          <div className="c-slab">
            {recent}
            <div className="c-col">
              {owed}
              {fees}
              {months}
              {terms}
            </div>
            {people}
          </div>
          {more && (
            <div className="c-slab c-ov-slab2">
              <div className="c-col">
                <PaidByCell more={more} onCharges={go('/charges')} />
                <ItemsCell more={more} onInventory={go('/inventory')} />
              </div>
              <div className="c-col">
                <ExtrasCell more={more} onTax={go('/settings/tax')} />
                <EodCell more={more} onAll={go('/close')} />
              </div>
            </div>
          )}
        </>
      )}
      {open === 'statements' && <StatementsSheet months={statements} onClose={() => setOpen(null)} />}
      {open === 'terms' && <TermsSheet m={m} onClose={() => setOpen(null)} />}
    </>
  );
}
