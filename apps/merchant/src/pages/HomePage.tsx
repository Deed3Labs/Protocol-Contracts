import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/authContext';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import { HomeView, type HomeActions } from '@/home/HomeView';
import { clockTime, fromApi, type HomeModel, type WaitingCharge } from '@/home/model';
import { DANA_STEPS, HOME_STATES, type HomeState } from '@/home/seed';
import { WaitingSheet, type Milestone } from '@/home/WaitingSheet';
import { useLayout } from '@/lib/useBreakpoint';
import { TillCell, TillHero, type TillItem } from '@/onboarding/views';

/**
 * Home — docs/merchant-reference/clear-merchant-home.html.
 *
 * A live shop's Home is built from what the API answers today (home/model.ts `fromApi`). In
 * development, `?home=running|counter|onBreak|early|dayOne|closing` shows the reference scenario
 * instead, so every state can be looked at without a database; it falls out of a production build.
 */
export default function HomePage() {
  const { session } = useAuth();
  const layout = useLayout();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [open, setOpen] = useState<WaitingCharge | null>(null);

  const forced = import.meta.env.DEV ? (params.get('home') as HomeState | null) : null;
  const seeded = forced && forced in HOME_STATES ? HOME_STATES[forced] : null;

  const { data: charges, reload } = useApi(() => api.charges({ limit: 100 }), []);
  // Owners and managers only; a counter shift is refused these, and the cells that need them are
  // not drawn for that role anyway.
  const { data: position } = useApi(() => api.payouts(), []);
  const { data: staff } = useApi(() => api.staff(), []);

  const model: HomeModel | null = useMemo(() => {
    if (seeded) return seeded;
    if (!session) return null;
    return fromApi({
      role: session.staff.role,
      staffId: session.staff.id,
      charges: charges ?? [],
      position,
      staff,
    });
  }, [seeded, session, charges, position, staff]);

  // After onboarding: the till checklist, from the Onboarding reference (`?home=till|till4`). A live
  // shop doesn't see it yet: nothing records which of these a shop has done.
  const till = import.meta.env.DEV ? params.get('home') : null;
  if (till === 'till' || till === 'till4') {
    const four = till === 'till4';
    const items: TillItem[] = [
      { t: 'Connect Stripe to take cards', det: 'Settings › Payments', done: four, onOpen: () => navigate('/settings/payments?preview=1') },
      { t: 'Pair a card reader', det: 'An M2, a smart reader, or a phone', done: four, onOpen: () => navigate('/settings/devices?preview=1') },
      { t: 'Add what you sell', det: 'One at a time, or import a spreadsheet', done: four, onOpen: () => navigate('/inventory?preview=1') },
      { t: 'Your team', det: 'Jen and Luis, added at signup', done: true, onOpen: () => navigate('/staff?preview=1') },
      { t: 'Set starting cash', det: 'For the drawer, $150.00 is common', onOpen: () => navigate('/settings/closing?preview=1') },
      { t: 'Tips and discounts', det: 'Optional', onOpen: () => navigate('/settings/tips?preview=1') },
    ];
    return (
      <>
        <TillHero
          cents={four ? '$412.00' : '$0.00'}
          det={four ? '1 confirmed today' : 'No charges yet. The first one is one tap away.'}
          cart={four}
          onNew={() => navigate('/new?preview=1')}
          onCart={() => navigate('/new?preview=1&items=1')}
        />
        <TillCell items={items} />
      </>
    );
  }

  if (!model) return null;

  const a: HomeActions = {
    onNewCharge: () => navigate('/new'),
    onBuildCart: () => navigate('/new?items=1'),
    onOpenWaiting: setOpen,
    onAllCharges: () => navigate('/charges'),
    onPayouts: () => navigate('/payouts'),
    onStaff: () => navigate('/staff'),
    onSetup: (s) => {
      if (s.key === 'staff') navigate('/staff');
      if (s.key === 'test') navigate('/new');
    },
    onCloseDay: () => navigate(`/close${seeded ? '?drawer=short' : ''}`),
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
      <HomeView m={model} layout={layout} a={a} />
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
