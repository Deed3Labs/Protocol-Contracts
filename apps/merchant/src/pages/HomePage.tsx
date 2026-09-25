import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/authContext';
import { api } from '@/data/apiClient';
import { useMerchantApi } from '@/data/merchantApi';
import { errorSentence, useApi } from '@/data/useApi';
import { CountResultSheet, CountSheet, OpenDrawerSheet, SignOffSheet } from '@/home/drawer';
import { HomeView, type HomeActions } from '@/home/HomeView';
import { drawerPrompt, drawerStep } from '@/home/liveDrawer';
import { clockTime, fromApi, type HomeModel, type TillItem, type WaitingCharge } from '@/home/model';
import { DANA_STEPS, HOME_STATES, type HomeState } from '@/home/seed';
import { WaitingSheet, type Milestone } from '@/home/WaitingSheet';
import { useLayout } from '@/lib/useBreakpoint';

/**
 * Home — docs/merchant-reference/clear-merchant-home.html.
 *
 * A live shop's Home is built from what the API answers today (home/model.ts `fromApi`), and its
 * drawer from the merchant API: open it, the two blind counts, a recount, the sign-off, then Close
 * the day (home/liveDrawer.ts). In
 * development, `?home=running|counter|onBreak|early|dayOne|tillLater|closing|lowStock` shows the reference scenario
 * instead, so every state can be looked at without a database; it falls out of a production build.
 */
const TILL_HIDDEN = 'clear.merchant.tillHidden';

/** Where each row of Set up the till goes. */
const TILL_TO: Record<TillItem['key'], string> = {
  stripe: '/settings/payments',
  reader: '/settings/devices',
  items: '/inventory',
  team: '/staff',
  cash: '/settings/closing',
  tips: '/settings/tips',
};

export default function HomePage() {
  const { session } = useAuth();
  const layout = useLayout();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [open, setOpen] = useState<WaitingCharge | null>(null);
  const [tillHidden, setTillHidden] = useState(() => {
    if (import.meta.env.DEV && params.get('home')) return false;
    try {
      return localStorage.getItem(TILL_HIDDEN) === '1';
    } catch {
      return false;
    }
  });

  const forced = import.meta.env.DEV ? (params.get('home') as HomeState | null) : null;
  const seeded = forced && forced in HOME_STATES ? HOME_STATES[forced] : null;

  const { data: charges, reload } = useApi(() => api.charges({ limit: 100 }), []);
  // Owners and managers only; a counter shift is refused these, and the cells that need them are
  // not drawn for that role anyway.
  const { data: position } = useApi(() => api.payouts(), []);
  const { data: staff } = useApi(() => api.staff(), []);

  // ---- The drawer (a live shop) ------------------------------------------------------------------
  const merchant = useMerchantApi();
  const drawerNow = useApi(() => (seeded || !session ? Promise.resolve(null) : merchant.drawer()), [seeded, !!session]);
  const openSession = drawerNow.data;
  const countsNow = useApi(() => (openSession ? merchant.counts(openSession.id) : Promise.resolve(null)), [openSession?.id]);
  const shopSettings = useApi(() => (seeded || !session ? Promise.resolve(null) : merchant.settings()), [seeded, !!session]);
  // Who counted, by name (a counter shift is refused the roster, and sees "The first counter").
  const roster = useApi(() => (seeded || !session ? Promise.resolve(null) : merchant.staff()), [seeded, !!session]);
  // The preview's settings ride along to Close the day.
  const keep = params.get('preview') === '1' ? `?${params.toString()}` : '';
  // Today's sales, every way they were paid (the confirmed list, the total, who raised what).
  const todayIso = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const ordersToday = useApi(() => (seeded || !session ? Promise.resolve(null) : merchant.orders({ date: todayIso })), [seeded, !!session, todayIso]);
  const [drawerSheet, setDrawerSheet] = useState<null | { k: 'open' } | { k: 'count'; which: 'first' | 'second' } | { k: 'result' } | { k: 'signoff' }>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const names = useMemo(() => {
    const m = new Map<string, string>([...(staff ?? []), ...(roster.data ?? [])].map((x) => [x.id, x.name]));
    if (session) m.set(session.staff.id, session.staff.name);
    return m;
  }, [staff, roster.data, session]);
  const me = session?.staff.id ?? '';
  const nameOf = (id: string) => names.get(id) ?? 'The first counter';
  const now = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
  const drawerDo = async (fn: () => Promise<unknown>, next: typeof drawerSheet = null) => {
    setDrawerError(null);
    try {
      await fn();
      drawerNow.reload();
      countsNow.reload();
      setDrawerSheet(next);
    } catch (e) {
      setDrawerError(errorSentence(e));
    }
  };

  const model: HomeModel | null = useMemo(() => {
    if (seeded) return seeded;
    if (!session) return null;
    return fromApi({
      role: session.staff.role,
      staffId: session.staff.id,
      charges: charges ?? [],
      position,
      staff: staff ?? (roster.data ? roster.data.map((x) => ({ ...x, pinSet: true, chargesThisMonth: 0 })) : null),
      orders: ordersToday.data,
      nameOf: (id) => names.get(id) ?? '—',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded, session, charges, position, staff, ordersToday.data, roster.data, names]);

  if (!model) return null;
  const view = countsNow.data;
  const liveModel: HomeModel = seeded || drawerNow.loading ? model : { ...model, drawer: drawerPrompt(openSession ?? null, view ?? null, me, names) };

  const a: HomeActions = {
    onNewCharge: () => navigate('/new'),
    onBuildCart: () => navigate('/new?items=1'),
    onOpenWaiting: setOpen,
    onAllCharges: () => navigate('/charges'),
    onPayouts: () => navigate('/payouts'),
    onStaff: () => navigate('/staff'),
    // Each row opens the screen that already does it.
    onTill: (t) => navigate(`${TILL_TO[t.key]}${seeded ? '?preview=1' : ''}`),
    onHideTill: () => {
      setTillHidden(true);
      // The preview's scenario hides for this visit only; a shop's choice is remembered on the tablet.
      if (seeded) return;
      try {
        localStorage.setItem(TILL_HIDDEN, '1');
      } catch {
        // Hidden for this visit only.
      }
    },
    onCloseDay: () => navigate(`/close${seeded ? '?drawer=short' : ''}`),
    onDrawer: () => {
      setDrawerError(null);
      const step = drawerStep(openSession ?? null, view ?? null, me);
      if (step.kind === 'open') setDrawerSheet({ k: 'open' });
      else if (step.kind === 'count') setDrawerSheet({ k: 'count', which: step.which });
      else if (step.kind === 'result') setDrawerSheet({ k: 'result' });
      else if (step.kind === 'close') navigate(`/close${keep}`);
      // 'wait': the panel already says the second count is someone else's.
    },
    onMarkReordered: (id) => navigate(`/inventory/${id}${seeded ? '?preview=1&screen=reorder' : ''}`),
    onInventory: () => navigate(`/inventory${seeded ? '?preview=1' : ''}`),
  };

  // What a waiting charge has been through. The API knows when it was raised and when it was opened;
  // text and email delivery are the reference's, and arrive when the backend records them.
  const steps = (w: WaitingCharge): Milestone[] => {
    if (seeded && w.id === 'dana') return DANA_STEPS;
    const c = charges?.find((x) => x.code === w.id);
    return [
      { t: 'Raised', det: c ? `${c.raisedBy ? `By ${c.raisedBy.split(/\s+/)[0]} at ` : ''}${clockTime(c.createdAt)}` : '—', state: 'done' },
      w.opened
        ? { t: 'App opened', det: w.ago, state: 'now' }
        : { t: 'App opened', det: 'Not yet', state: 'later' },
      { t: 'Approved', det: 'Not yet', state: 'later' },
    ];
  };

  return (
    <>
      <HomeView m={tillHidden ? { ...liveModel, till: undefined } : liveModel} layout={layout} a={a} />
      {drawerError && !drawerSheet && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', margin: 'var(--s2) 0' }}>
          {drawerError}
        </p>
      )}
      {drawerSheet?.k === 'open' && (
        <OpenDrawerSheet
          name={session?.staff.name ?? ''}
          at={now()}
          lastCloseCents={shopSettings.data?.startingCashCents ?? 15000}
          onStart={(cents) => void drawerDo(() => merchant.openDrawer({ startingCashCents: cents }))}
          onClose={() => setDrawerSheet(null)}
        />
      )}
      {drawerSheet?.k === 'count' && openSession && (
        <CountSheet
          which={drawerSheet.which}
          name={session?.staff.name ?? ''}
          at={now()}
          onSave={(cents) =>
            void (async () => {
              setDrawerError(null);
              try {
                const v = await merchant.saveCount(openSession.id, { method: 'total', totalCents: cents });
                countsNow.reload();
                drawerNow.reload();
                // Both in: straight to what they show. One in: back to Home, which says who's next.
                setDrawerSheet(v.state === 'disagree' || v.state === 'compared' ? { k: 'result' } : null);
              } catch (e) {
                setDrawerError(errorSentence(e));
              }
            })()
          }
          onClose={() => setDrawerSheet(null)}
        />
      )}
      {drawerSheet?.k === 'result' && openSession && view && (view.state === 'disagree' || view.state === 'compared') && (
        <CountResultSheet
          outcome={view.state === 'disagree' ? 'disagree' : view.differenceCents === 0 ? 'match' : 'short'}
          first={{ name: nameOf(view.counts[0].counter), cents: view.counts[0].totalCents }}
          second={{ name: nameOf((view.counts[1] ?? view.counts[0]).counter), cents: (view.counts[1] ?? view.counts[0]).totalCents }}
          // Never shown while the counts disagree: the server doesn't send it.
          expectedCents={view.state === 'compared' ? view.expectedCents : 0}
          note={note}
          onNote={setNote}
          onDone={() => {
            setDrawerSheet(null);
            if (view.state === 'compared' && !view.signoffNeeded) navigate(`/close${keep}`);
          }}
          onRecount={(which) => void drawerDo(() => merchant.recount(openSession.id, { which }), { k: 'count', which })}
          onAskSignOff={() => {
            setPin('');
            setDrawerSheet({ k: 'signoff' });
          }}
          onClose={() => setDrawerSheet(null)}
        />
      )}
      {drawerSheet?.k === 'signoff' && openSession && view?.state === 'compared' && (
        <SignOffSheet
          expectedCents={view.expectedCents}
          countedCents={view.counts[0].totalCents}
          counters={[nameOf(view.counts[0].counter), nameOf((view.counts[1] ?? view.counts[0]).counter)]}
          note={note || 'Signed off at close'}
          signer={session && session.staff.role !== 'counter' && session.staff.id !== view.counts[0].counter ? { name: session.staff.name, role: session.staff.role === 'owner' ? 'Owner' : 'Manager' } : { name: 'An owner or manager', role: 'Not the first counter' }}
          pinFilled={pin.length}
          onKey={(k) => setPin((p) => (k === 'del' ? p.slice(0, -1) : p.length >= 4 ? p : p + k))}
          onSomeoneElse={() => setPin('')}
          onCountAgain={() => setDrawerSheet({ k: 'result' })}
          onSignOff={() =>
            void drawerDo(async () => {
              await merchant.signOff(openSession.id, { note: note.trim() || 'Signed off at close', pin });
              setPin('');
              navigate(`/close${keep}`);
            })
          }
          onClose={() => setDrawerSheet(null)}
        />
      )}
      {drawerError && drawerSheet && (
        <p className="c-det" role="alert" style={{ position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 60, color: 'var(--absent)', background: 'var(--paper)', padding: 'var(--s2)', border: '1px solid var(--absent)' }}>
          {drawerError}
        </p>
      )}
      {open && (
        <WaitingSheet
          name={open.name}
          amountCents={open.amountCents}
          opened={open.opened}
          steps={steps(open)}
          onClose={() => setOpen(null)}
          onCancel={async () => {
            if (!seeded) {
              await api.cancelCharge(open.id).catch(() => undefined);
              reload();
            }
            setOpen(null);
          }}
        />
      )}
    </>
  );
}
