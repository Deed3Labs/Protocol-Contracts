import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/authContext';
import { OwnerSignIn } from '@/auth/OwnerSignIn';
import { IdleLockScreen, type ShiftPerson } from '@/auth/screens';
import { usePinAttempts } from '@/auth/pinAttempts';
import { useDigitKeys } from '@/brand/ui';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import { useLayout } from '@/lib/useBreakpoint';
import { rememberShop } from '@/lib/shopName';
import { usePage, type ReferencePage } from '@/lib/usePage';
import { applyAppearance, readAppearance, type Appearance } from '@/shell/appearance';
import {
  PhoneNav,
  PhoneTop,
  PinSheet,
  PlusSheet,
  ProfileSheet,
  TopBar,
  WhoIsOnSheet,
  resettersOf,
  roleLabel,
  type NavKey,
  type ProfileRow,
  type RosterPerson,
} from '@/shell/chrome';

/**
 * The shell every signed-in screen sits in, at all three widths.
 *
 * Above 900px the tablet header: "Clear | shop", six destinations, the shift pill and the avatar.
 * Between 520 and 900 the same header with the nav on its own row. Below 520 the phone: the
 * lockup and shift at the top, the six destinations as icons in a floating bar, and New charge on
 * the action button. **Nothing is removed at any width**; only the arrangement changes.
 *
 * It also owns the three things that sit over any screen: the profile sheet behind the avatar, the
 * shift change behind the pill, and the lock after the tablet's idle minutes.
 */

/** Routes that are flows rather than pages. */
const FLOWS = ['/close', '/new'];

type Open = 'profile' | 'who' | 'pin' | 'owner' | 'plus' | null;

const SECTION: [string, NavKey][] = [
  ['/charges', 'charges'],
  ['/inventory', 'inventory'],
  ['/payouts', 'payouts'],
  ['/staff', 'staff'],
  ['/overview', 'overview'],
];

/** Which reference file a route is drawn from. */
function pageOf(path: string): ReferencePage | null {
  if (path === '/' || path.startsWith('/close')) return 'home';
  if (path.startsWith('/new')) return 'new-charge';
  for (const p of ['charges', 'inventory', 'payouts', 'staff', 'overview', 'settings', 'onboarding'] as const)
    if (path === `/${p}` || path.startsWith(`/${p}/`)) return p;
  return null;
}

function sectionOf(path: string): NavKey | null {
  if (path === '/') return 'home';
  return SECTION.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1] ?? null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, device, canSeeMoney, signOut, signInWithPin, refresh } = useAuth();
  const layout = useLayout();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Open>(null);
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  usePage(pageOf(pathname));

  // The shop's name, in the one place it appears on every screen. Remembered on the tablet too, so
  // the shift screen can show it before anyone is on.
  const { data: profile } = useApi(() => api.profile(), []);
  useEffect(() => rememberShop(profile?.name), [profile?.name]);
  // The dev preview (`?preview=1`) stands up a session with no API behind it; it is the
  // reference scenario's shop.
  const shop = profile?.name ?? (import.meta.env.DEV && device?.id === 'preview' ? 'Mike\u2019s Tire' : '');

  // ---- Changing who is on the counter --------------------------------------------------------
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [picked, setPicked] = useState<RosterPerson | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attempts = usePinAttempts();

  useEffect(() => {
    if (open !== 'who') return;
    api
      .roster()
      .then(setRoster)
      .catch(() => setRoster([]));
  }, [open]);

  // ---- The idle lock -------------------------------------------------------------------------
  const idleSeconds = device?.idleLockSeconds ?? 300;
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (locked) return;
    let timer = window.setTimeout(() => setLocked(true), idleSeconds * 1000);
    const touch = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLocked(true), idleSeconds * 1000);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [locked, idleSeconds]);

  const closeSheets = useCallback(() => {
    setOpen(null);
    setPicked(null);
    setPin('');
    setPinError(null);
  }, []);

  // A PIN goes on its fourth digit, whether it is someone taking over or the same person unlocking.
  const who = picked ?? (locked && session ? (session.staff as RosterPerson) : null);
  useEffect(() => {
    if (pin.length !== 4 || !who || busy) return;
    setBusy(true);
    signInWithPin(pin, who.id)
      .then(() => {
        closeSheets();
        setLocked(false);
        attempts.reset();
      })
      .catch((e: unknown) => {
        const status = (e as { status?: number })?.status;
        setPinError(status === 429 && e instanceof Error ? e.message : attempts.miss());
        setPin('');
      })
      .finally(() => setBusy(false));
  }, [pin, who, busy, signInWithPin, closeSheets, attempts]);

  const typing = !!who && !busy && !attempts.waiting && (open === 'pin' || (locked && open === null));
  const digit = (d: string) => {
    setPinError(null);
    setPin((p) => (p.length >= 4 ? p : p + d));
  };
  const del = () => setPin((p) => p.slice(0, -1));
  useDigitKeys(typing, digit, del);

  if (!session) return null;
  const staff = session.staff;
  const role = staff.role;
  const current = sectionOf(pathname);

  const pickSheets = (
    <>
      {open === 'who' && (
        <WhoIsOnSheet
          people={roster}
          onClose={closeSheets}
          onPick={(p) => {
            setPicked(p);
            setPin('');
            setPinError(null);
            attempts.reset();
            setOpen('pin');
          }}
        />
      )}
      {open === 'pin' && picked && (
        <PinSheet
          name={picked.name}
          filled={pin.length}
          error={pinError}
          disabled={!typing}
          resetters={resettersOf(roster)}
          onDigit={digit}
          onDelete={del}
          onNotMe={() => {
            setPicked(null);
            setPin('');
            setOpen('who');
          }}
          onClose={closeSheets}
        />
      )}
    </>
  );

  // Locked: the shift keeps running underneath, so the same PIN opens it, or someone else starts
  // a different shift.
  if (locked) {
    const person: ShiftPerson = { id: staff.id, name: staff.name, role };
    return (
      <>
        <IdleLockScreen
          shop={shop}
          person={person}
          minutes={Math.round(idleSeconds / 60)}
          filled={open === null ? pin.length : 0}
          error={open === null ? pinError : null}
          disabled={!typing}
          onDigit={digit}
          onDelete={del}
          onSomeoneElse={() => {
            setPin('');
            setPinError(null);
            setOpen('who');
          }}
        />
        {pickSheets}
      </>
    );
  }

  // Inside a flow the nav gives way to the flow's own header (close or back, what this is, who is
  // on shift), which the flow draws itself. The lock above still applies.
  if (FLOWS.some((f) => pathname === f || pathname.startsWith(`${f}/`))) return <>{children}</>;

  const header = {
    shop,
    current,
    role,
    onShift: staff.name,
    avatarName: staff.name,
    onChangeShift: () => setOpen('who'),
    onProfile: () => setOpen('profile'),
    onLocked: () => setOpen('owner'),
  };

  // What the profile sheet lists. The owner's rows (terms, the cash account) appear only for
  // someone who sees money; destinations not built yet are rows that go nowhere for now.
  const go = (to: string) => () => {
    closeSheets();
    navigate(to);
  };
  const tablet: ProfileRow = { label: 'This tablet', value: `${device?.label ?? 'This tablet'} · enrolled` };
  const rows: ProfileRow[] = canSeeMoney
    ? [
        { label: 'Settings', onClick: go('/settings') },
        { label: 'Your terms', onClick: go('/overview') },
        { label: 'Cash account', onClick: go('/payouts') },
        { label: 'Counter materials' },
        tablet,
        { label: 'Help' },
      ]
    : [tablet, { label: 'Help' }];

  return (
    // `@container`: the pages not yet converted size themselves with container queries.
    <div className="c-app c-mc-tablet c-mc-page @container">
      {layout === 'phone' ? <PhoneTop {...header} /> : <TopBar {...header} />}

      {/* No wrapper around the page: the reference's rules reach its blocks as direct children of
          the tablet (`.mc-tablet > .slab`), so the page's blocks sit right here. */}
      {children}

      {layout === 'phone' && <PhoneNav current={current} role={role} onPlus={() => setOpen('plus')} onLocked={() => setOpen('owner')} />}

      {open === 'plus' && (
        <PlusSheet onClose={closeSheets} onAmount={go('/new')} onCart={go('/new?items=1')} />
      )}

      {open === 'profile' && (
        <ProfileSheet
          name={staff.name}
          subtitle={role === 'owner' ? 'Owner · signed in' : `${roleLabel(role)} · on shift`}
          owner={role === 'owner'}
          rows={rows}
          appearance={appearance}
          onAppearance={(a) => {
            setAppearance(a);
            applyAppearance(a);
          }}
          onEndShift={() => {
            closeSheets();
            void signOut();
          }}
          onOwnerSignIn={() => setOpen('owner')}
          onOwnerSignOut={() => {
            closeSheets();
            void signOut();
          }}
          onClose={closeSheets}
        />
      )}

      {open === 'owner' && (
        <OwnerSignIn
          variant="sheet"
          onBack={closeSheets}
          onDone={async () => {
            await refresh();
            closeSheets();
          }}
        />
      )}

      {pickSheets}
    </div>
  );
}

/**
 * Two equal columns above 900px, one below — action first either way.
 *
 * The pages not yet converted to the reference still lay themselves out with this. It goes when
 * the last of them does.
 */
export function Columns({ action, context }: { action: ReactNode; context: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="grid flex-1 grid-cols-1 gap-3.5 @[900px]:grid-cols-2">
        <div className="flex min-w-0 flex-col">{action}</div>
        <div className="flex min-w-0 flex-col">{context}</div>
      </div>
    </div>
  );
}
