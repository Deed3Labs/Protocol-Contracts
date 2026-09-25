import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { StaffRole } from '@clear/domain';
import { seesMoney } from '@clear/domain';
import {
  IconAmount,
  IconBack,
  IconCart,
  IconChevron,
  IconChevronInk,
  IconCharges,
  IconCloseLg,
  IconHome,
  IconInventory,
  IconKey,
  IconLock,
  IconOverview,
  IconPayouts,
  IconPlus,
  IconStaff,
} from '@/brand/icons';
import { Lockup, PinDots, PinKeys, Sheet, cx, initials } from '@/brand/ui';

/**
 * The shell's parts, drawn from docs/merchant-reference/: the header lockup and nav, the shift
 * pill, the phone's bar and + sheet, the flow header, and the sheets the shell opens.
 *
 * All of it is presentational. AppShell decides what is true (who is on shift, which page is
 * open); these only draw it, which is what lets the component gallery show every state.
 */

// ---- Navigation -------------------------------------------------------------------------------

export type NavKey = 'home' | 'charges' | 'inventory' | 'payouts' | 'staff' | 'overview';

/**
 * Six destinations, in the reference's order. On a counter shift Payouts and Overview stay in
 * place with a padlock rather than disappearing: a writer learns where they are, and an owner
 * knows where to sign in. Inventory is open to everyone.
 */
export const NAV: { key: NavKey; to: string; label: string; icon: () => ReactNode; money?: boolean }[] = [
  { key: 'home', to: '/', label: 'Home', icon: IconHome },
  { key: 'charges', to: '/charges', label: 'Charges', icon: IconCharges },
  { key: 'inventory', to: '/inventory', label: 'Inventory', icon: IconInventory },
  { key: 'payouts', to: '/payouts', label: 'Payouts', icon: IconPayouts, money: true },
  { key: 'staff', to: '/staff', label: 'Staff', icon: IconStaff },
  { key: 'overview', to: '/overview', label: 'Overview', icon: IconOverview, money: true },
];

/** Locked for this role: the money pages, for anyone who does not see money. */
export const isLocked = (role: StaffRole, key: NavKey) =>
  !seesMoney(role) && NAV.some((n) => n.key === key && n.money);

// ---- Pieces shared by the tablet and phone headers --------------------------------------------

/** The live dot and "Jen on shift". Tapping it changes who is on the counter. */
export function ShiftPill({ name, small, onClick }: { name: string; small?: boolean; onClick?: () => void }) {
  const first = name.split(/\s+/)[0] ?? name;
  return small ? (
    <button type="button" className="c-mc-shift c-sm" aria-label={`${first} on shift, change shift`} onClick={onClick}>
      <i />
      <b>{first}</b>
    </button>
  ) : (
    <button type="button" className="c-mc-shift" aria-label="Change shift" onClick={onClick}>
      <i />
      <span>
        <b>{first}</b> on shift
      </span>
    </button>
  );
}

export function AvatarButton({ name, small, onClick }: { name: string; small?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={cx('c-avatarbtn', small && 'c-sm')} aria-label="Profile" onClick={onClick}>
      {initials(name)}
    </button>
  );
}

/** The owner's sign-in, beside the shift rather than instead of it. */
export function OwnerChip({ until }: { until: string }) {
  return (
    <span className="c-si-owner">
      <IconKey />
      <span>
        <b>Owner</b> until {until}
      </span>
    </span>
  );
}

// ---- Tablet header ----------------------------------------------------------------------------

export interface HeaderProps {
  shop: string;
  current: NavKey | null;
  role: StaffRole;
  /** Whoever is on shift. */
  onShift: string;
  /** Whose initials the avatar shows: the owner when signed in, otherwise whoever is on shift. */
  avatarName: string;
  ownerUntil?: string;
  onChangeShift?: () => void;
  onProfile?: () => void;
  /** A padlocked destination was tapped: the owner signs in for it. */
  onLocked?: () => void;
  /** Real links in the app; plain spans in the gallery, where there is nowhere to go. */
  static?: boolean;
}

export function TopBar({ shop, current, role, onShift, avatarName, ownerUntil, onChangeShift, onProfile, onLocked, static: still }: HeaderProps) {
  return (
    <div className="c-mc-top">
      <Lockup shop={shop} />
      <nav aria-label="Main">
        {NAV.map((n) => {
          if (isLocked(role, n.key)) {
            // Dimmed with a padlock, and leading to the owner's sign-in (Home reference, Open).
            return (
              <span
                key={n.key}
                className="c-mc-lock"
                role="button"
                tabIndex={0}
                aria-label={`${n.label}, needs the owner`}
                style={{ cursor: onLocked ? 'pointer' : undefined }}
                onClick={onLocked}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onLocked?.()}
              >
                {n.label}
                <span className="c-mc-lockg">
                  <IconLock />
                </span>
              </span>
            );
          }
          if (still) {
            return (
              <span key={n.key} className={current === n.key ? 'c-on' : undefined}>
                {n.label}
              </span>
            );
          }
          return (
            <NavLink key={n.key} to={n.to} end={n.to === '/'} className={() => (current === n.key ? 'c-on' : '')}>
              <span>{n.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <span className="c-mc-right">
        {ownerUntil && <OwnerChip until={ownerUntil} />}
        <ShiftPill name={onShift} onClick={onChangeShift} />
        <AvatarButton name={avatarName} onClick={onProfile} />
      </span>
    </div>
  );
}

// ---- Phone ------------------------------------------------------------------------------------

export function PhoneTop({ shop, onShift, avatarName, onChangeShift, onProfile }: HeaderProps) {
  return (
    <div className="c-mc-phonetop">
      <Lockup shop={shop} small />
      <span className="c-mc-right">
        <ShiftPill name={onShift} small onClick={onChangeShift} />
        <AvatarButton name={avatarName} small onClick={onProfile} />
      </span>
    </div>
  );
}

/**
 * The phone's floating bar: six icons and the action button. On a counter shift the owner-only
 * two are dimmed rather than removed, as the reference draws them.
 */
export function PhoneNav({
  current,
  role,
  onPlus,
  onLocked,
  static: still,
}: {
  current: NavKey | null;
  role: StaffRole;
  onPlus?: () => void;
  onLocked?: () => void;
  static?: boolean;
}) {
  return (
    <div className="c-navwrap">
      <nav className="c-navbar" aria-label="Main">
        {NAV.map((n) => {
          const locked = isLocked(role, n.key);
          const Icon = n.icon;
          const cls = current === n.key ? 'c-on' : undefined;
          const style = locked ? { color: 'var(--ink-28)' } : undefined;
          if (locked || still) {
            return (
              <a
                key={n.key}
                className={cls}
                aria-label={locked ? `${n.label}, needs the owner` : n.label}
                role={locked ? 'button' : undefined}
                tabIndex={locked ? 0 : undefined}
                style={style}
                onClick={locked ? onLocked : undefined}
              >
                <Icon />
              </a>
            );
          }
          return (
            <NavLink key={n.key} to={n.to} end={n.to === '/'} aria-label={n.label} className={() => cls ?? ''}>
              <Icon />
            </NavLink>
          );
        })}
      </nav>
      <button type="button" className="c-navfab" aria-label="New charge" onClick={onPlus}>
        <IconPlus />
      </button>
    </div>
  );
}

/**
 * The + sheet. On the phone there is no room for New charge and Build cart side by side, so the
 * action button asks which.
 */
export function PlusSheet({
  onAmount,
  onCart,
  onClose,
  inline,
}: {
  onAmount?: () => void;
  onCart?: () => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const body = (
    <>
      <div className="c-ps-scrim" onClick={onClose} />
      <div className="c-ps-sheet" role="dialog" aria-modal={!inline || undefined} aria-label="Start a charge">
        <div className="c-ps-grab" />
        <div className="c-ps-head">
          <p className="c-mtitle">Start a charge</p>
          <button type="button" className="c-ps-x" aria-label="Close" onClick={onClose}>
            <IconCloseLg />
          </button>
        </div>
        <button type="button" className="c-ps-opt" onClick={onAmount}>
          <span className="c-ic">
            <IconAmount />
          </span>
          <div>
            <p className="c-t">Type an amount</p>
            <p className="c-det">From the ticket, one figure</p>
          </div>
          <IconChevronInk />
        </button>
        <button type="button" className="c-ps-opt" onClick={onCart}>
          <span className="c-ic">
            <IconCart />
          </span>
          <div>
            <p className="c-t">Build a cart</p>
            <p className="c-det">Pick items from Inventory</p>
          </div>
          <IconChevronInk />
        </button>
        <p className="c-det c-ps-note">Both end at checkout, and then the same ways to pay.</p>
      </div>
    </>
  );
  return inline ? <div className="c-ps-phone">{body}</div> : body;
}

// ---- Inside a flow ----------------------------------------------------------------------------

/**
 * Inside a flow (new charge, card, cash, close the day) the nav gives way to this: close or back,
 * what this is, and who is on shift.
 */
export function FlowTop({
  title,
  back,
  onExit,
  middle,
  onShift,
  onChangeShift,
}: {
  title: ReactNode;
  /** A back arrow for a page inside a section; a close for a flow that is abandoned. */
  back?: boolean;
  onExit?: () => void;
  middle?: ReactNode;
  onShift: string;
  onChangeShift?: () => void;
}) {
  return (
    <div className="c-mc-flowtop">
      <span className="c-t">
        <button type="button" onClick={onExit} aria-label={back ? 'Back' : 'Close'} style={{ display: 'flex' }}>
          {back ? <IconBack /> : <IconCloseLg />}
        </button>
        {/* A long title trims rather than pushing the shift off a phone. */}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      </span>
      {middle}
      <span className="c-mc-right">
        <ShiftPill name={onShift} onClick={onChangeShift} />
      </span>
    </div>
  );
}

// ---- Sheets the shell opens -------------------------------------------------------------------

export interface ProfileRow {
  label: string;
  value?: ReactNode;
  onClick?: () => void;
}

/**
 * Behind the avatar. It differs by role, and has to: on a counter shift it opens on who is on,
 * with End shift, then appearance and this tablet, and no terms or cash account. Those rows
 * appear only once an owner has signed in.
 */
export function ProfileSheet({
  name,
  subtitle,
  owner,
  rows,
  appearance,
  onAppearance,
  onEndShift,
  onOwnerSignIn,
  onOwnerSignOut,
  onClose,
  inline,
}: {
  name: string;
  subtitle: string;
  owner: boolean;
  rows: ProfileRow[];
  appearance: 'light' | 'dusk' | 'dark';
  onAppearance?: (a: 'light' | 'dusk' | 'dark') => void;
  onEndShift?: () => void;
  onOwnerSignIn?: () => void;
  onOwnerSignOut?: () => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  return (
    <Sheet
      inline={inline}
      onClose={onClose}
      label="Profile"
      head={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="c-avatarbtn" style={{ width: 40, height: 40, cursor: 'default' }}>
              {initials(name)}
            </span>
            <span>
              <span style={{ display: 'block', fontSize: 'var(--t-body)', fontWeight: 500 }}>{name}</span>
              <span className="c-det" style={{ display: 'block', marginTop: 2 }}>
                {subtitle}
              </span>
            </span>
          </span>
          <button type="button" className="c-btn" onClick={onEndShift}>
            End shift
          </button>
        </div>
      }
      foot={
        owner ? (
          <button type="button" className="c-btn c-btn-lg" onClick={onOwnerSignOut}>
            Sign out as owner
          </button>
        ) : (
          <>
            <p className="c-det" style={{ marginBottom: 'var(--s2)' }}>
              Terms, payouts and settings need an owner.
            </p>
            <button type="button" className="c-btn c-btn-lg" onClick={onOwnerSignIn}>
              Owner sign in
            </button>
          </>
        )
      }
    >
      <p className="c-label" style={{ marginBottom: 6 }}>
        Appearance
      </p>
      <div className="c-qc c-split" style={{ marginTop: 0 }}>
        {(['light', 'dusk', 'dark'] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={cx('c-btn c-chip-q', appearance === a && 'c-on')}
            aria-pressed={appearance === a}
            onClick={() => onAppearance?.(a)}
          >
            {a[0].toUpperCase() + a.slice(1)}
          </button>
        ))}
      </div>
      <div className="c-rows" style={{ marginTop: 'var(--s3)' }}>
        {rows.map((r) => (
          <div key={r.label}>
            <div className="c-kv" style={{ cursor: 'pointer' }} role="button" tabIndex={0} onClick={r.onClick}>
              <span>{r.label}</span>
              <span className="c-v">
                {r.value}
                <IconChevron />
              </span>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

export interface RosterPerson {
  id: string;
  name: string;
  role: StaffRole;
}

/** "Forgot it? Luis or Mike can reset it in Staff." */
export function ForgotLine({ resetters }: { resetters?: string }) {
  return (
    <p className="c-det c-si-forgot">
      <span className="c-si-link">Forgot it?</span>
      <span>{resetters ? `${resetters} can reset it in Staff.` : 'An owner can reset it in Staff.'}</span>
    </p>
  );
}

/** The people who can reset a PIN, by first name: "Luis or Mike", "Ana, Luis or Mike". */
export function resettersOf(people: RosterPerson[]): string | undefined {
  const names = people.filter((p) => p.role !== 'counter').map((p) => p.name.split(/\s+/)[0]);
  if (!names.length) return undefined;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

export const roleLabel =(r: StaffRole) => (r === 'owner' ? 'Owner' : r === 'manager' ? 'Manager' : 'Counter');

/** Changing who is on the counter, from the shift pill. A name first, never a bare PIN. */
export function WhoIsOnSheet({
  people,
  onPick,
  onClose,
  inline,
}: {
  people: RosterPerson[];
  onPick?: (p: RosterPerson) => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  return (
    <Sheet
      inline={inline}
      onClose={onClose}
      title="Who is on the counter?"
      foot={
        <p className="c-det">
          Every charge is recorded against whoever is on shift. The owner is in this list too &mdash; making them sign in differently to raise a charge is a reason to hand the tablet to someone else.
        </p>
      }
    >
      <div className="c-rows">
        {people.map((p) => (
          <div key={p.id}>
            <div className="c-line" style={{ alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="c-avatarbtn" style={{ cursor: 'default' }}>
                  {initials(p.name)}
                </span>
                <span>
                  <span style={{ display: 'block', fontSize: 'var(--t-sec)' }}>{p.name}</span>
                  <span className="c-det" style={{ display: 'block', marginTop: 2 }}>
                    {roleLabel(p.role)}
                  </span>
                </span>
              </span>
              <button type="button" className="c-btn" onClick={() => onPick?.(p)}>
                Start
              </button>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * A PIN, as a sheet over whatever is on screen: sign-in's pad and dots, titled with the person.
 * The wrong-PIN state is this sheet with `error` set.
 */
export function PinSheet({
  name,
  filled,
  error,
  disabled,
  onDigit,
  onDelete,
  onNotMe,
  onClose,
  inline,
  resetters,
}: {
  name: string;
  /** "Luis or Mike": the managers and owners, who can reset a PIN in Staff. */
  resetters?: string;
  filled: number;
  error?: string | null;
  disabled?: boolean;
  onDigit?: (d: string) => void;
  onDelete?: () => void;
  onNotMe?: () => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  return (
    <Sheet
      inline={inline}
      className="c-si-sheet"
      title={name}
      closeSize="lg"
      onClose={onClose}
      foot={
        error ? (
          <p className="c-det">After three, the tablet waits 30 seconds, then asks again.</p>
        ) : (
          <ForgotLine resetters={resetters} />
        )
      }
    >
      <PinDots filled={error ? 4 : filled} bad={!!error} />
      {error && (
        <p className="c-si-err" role="alert" style={{ textAlign: 'center' }}>
          {error}
        </p>
      )}
      <PinKeys
        disabled={disabled}
        onDigit={(d) => onDigit?.(d)}
        onDelete={() => onDelete?.()}
        left="Not me"
        onLeft={onNotMe}
      />
    </Sheet>
  );
}
