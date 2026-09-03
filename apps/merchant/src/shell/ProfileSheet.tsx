import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  CreditCard,
  FileText,
  HelpCircle,
  Settings,
  Shield,
  Tablet,
  X,
} from 'lucide-react';
import { dollars, fromCents } from '@clear/domain';
import { Cap } from '@/shell/ui';
import { useAuth } from '@/auth/authContext';
import { api, type MerchantProfile, type PayoutPosition } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import { type Appearance, applyAppearance, readAppearance } from '@/shell/appearance';

/**
 * The profile sheet — reference section 21.
 *
 * Five destinations in the nav and everything else behind the avatar. Home, Charges, Payouts,
 * Staff and Overview are what a shop opens during a shift; settings, terms, appearance and who is
 * on the counter are not, and mixing them makes the nav longer while making the frequent items
 * smaller.
 *
 * **It opens on who is on shift, with End shift directly beneath.** That is the most common reason
 * a writer taps their own avatar, and burying it under settings rows would be backwards.
 *
 * **Rows carry their current value** — the rate, the cash balance, whether this tablet is enrolled.
 * An owner checking a term should not have to open the row to see it.
 *
 * On mobile it slides up from the bottom with a grab handle and square top corners, matching every
 * other modal here and the member app: one motion, one dismissal gesture, learned once.
 */
export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { session, signOut, device, canSeeMoney } = useAuth();
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);

  // Only fetched for someone allowed to see money — the rows carry values, and a counter writer
  // must not read the rate or the balance off a sheet they opened to end their shift.
  const { data: profile } = useApi<MerchantProfile | null>(
    () => (canSeeMoney ? api.profile() : Promise.resolve(null)),
    [canSeeMoney],
  );
  const { data: position } = useApi<PayoutPosition | null>(
    () => (canSeeMoney ? api.payouts() : Promise.resolve(null)),
    [canSeeMoney],
  );

  const staff = session?.staff;
  const roleLabel =
    staff?.role === 'owner' ? 'Owner' : staff?.role === 'manager' ? 'Manager' : 'Counter';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 @[520px]:items-center">
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[20px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-2)] p-[1.1rem] pb-[1.6rem] @[520px]:max-w-[340px] @[520px]:rounded-[16px] @[520px]:pb-[1.1rem]">
        {/* .grab — 36x4, and only on the sheet that slid up from the bottom. */}
        <div className="mx-auto mb-[14px] h-1 w-9 rounded-[2px] bg-[var(--clear-border-strong)] @[520px]:hidden" />

        {/* Who is on shift, and the way off it. */}
        <div className="mb-[14px] flex items-center justify-end">
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={16} className="text-[var(--clear-text-secondary)]" />
          </button>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <Squircle name={staff?.name ?? ''} size={42} />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[15px] font-medium">{staff?.name ?? 'Not signed in'}</p>
            <p className="m-0 mt-0.5 text-[11.5px] text-[var(--clear-text-muted)]">
              On shift · {roleLabel}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void signOut();
            onClose();
          }}
          className="mb-4 w-full rounded-[8px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-1)] py-2.5 text-[12.5px]"
        >
          End shift
        </button>

        {/* A segment, not a toggle: 8am under fluorescents and 8pm are different problems. */}
        <Cap>Appearance</Cap>
        {/* A segmented track: one inset well with the selection raised out of it, rather than three
            separate bordered buttons. The difference reads as one control instead of three. */}
        <div className="mb-4 flex gap-[5px] rounded-[9px] bg-[var(--clear-surface-1)] p-[3px]">
          {(['light', 'dusk', 'dark'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                setAppearance(a);
                applyAppearance(a);
              }}
              className={`flex-1 rounded-[7px] py-[7px] text-[12px] capitalize ${
                appearance === a
                  ? 'bg-[var(--clear-surface-2)] text-[var(--clear-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                  : 'text-[var(--clear-text-secondary)]'
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        {canSeeMoney && (
          <>
            <Cap>Shop</Cap>
            <div className="mb-4 border-t-[0.5px] border-[var(--clear-border)]">
              <Prow icon={<Settings size={17} />} label="Settings" to="/settings" onClose={onClose} />
              <Prow
                icon={<Shield size={17} />}
                label="Your terms"
                value={
                  profile?.discountRate == null
                    ? '—'
                    : `${Math.round(profile.discountRate * 1000) / 10}% · ${profile.payoutTerms ?? 'net-30'}`
                }
                to="/overview"
                onClose={onClose}
              />
              <Prow
                icon={<CreditCard size={17} />}
                label="Cash account"
                value={
                  position?.cashAccountCents == null
                    ? '—'
                    : dollars(fromCents(position.cashAccountCents))
                }
                to="/payouts"
                onClose={onClose}
              />
              <Prow
                icon={<FileText size={17} />}
                label="Counter materials"
                to="/settings"
                onClose={onClose}
              />
            </div>
          </>
        )}

        <Cap>This tablet</Cap>
        <div className="mb-4 border-t-[0.5px] border-[var(--clear-border)]">
          <Prow
            icon={<Tablet size={17} />}
            label={device?.label ?? 'Not set up'}
            value={device ? 'Enrolled' : '—'}
            onClose={onClose}
          />
          {/* Help sits in this group in the reference rather than floating on its own. */}
          <Prow icon={<HelpCircle size={17} />} label="Help" to="/settings" onClose={onClose} />
        </div>

        {/* Quiet, and last. It is the escalation rather than the default, and under a writer's own
            profile is where an owner looks for it. */}
        {staff?.role !== 'owner' && (
          <Link
            to="/"
            onClick={onClose}
            className="block w-full rounded-[8px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-1)] py-2.5 text-center text-[12.5px]"
          >
            Owner sign in
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * A squircle, not a circle.
 *
 * Circles read as people; squircles read as accounts and entities, which is what a shift is —
 * matching the merchant avatars in the charges list.
 */
export function Squircle({ name, size = 34 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      style={{ width: size, height: size, borderRadius: '34%' }}
      className="flex shrink-0 items-center justify-center bg-[var(--clear-surface-0)] text-[12px] text-[var(--clear-text-secondary)]"
    >
      {initials}
    </span>
  );
}

/**
 * One row shape — `.prow` in the reference.
 *
 * An icon, a label, then whatever the row currently says pushed right against a chevron. Rows
 * carry their value so an owner checking a term does not have to open the row to read it, which
 * only works if the value and the affordance share the right-hand rail rather than competing.
 */
function Prow({
  icon,
  label,
  value,
  to,
  onClose,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  to?: string;
  onClose: () => void;
}) {
  const inner = (
    <>
      <span className="flex w-[19px] shrink-0 text-[var(--clear-text-secondary)]">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      <span className="ml-auto flex items-center gap-[7px] text-[12px] text-[var(--clear-text-muted)]">
        {value && <span className="tabular-nums">{value}</span>}
        {to && <ChevronRight size={13} />}
      </span>
    </>
  );
  const cls =
    'flex w-full items-center gap-[11px] border-b-[0.5px] border-[var(--clear-border)] py-[11px] text-left text-[13.5px] last:border-b-0';
  return to ? (
    <Link to={to} onClick={onClose} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
