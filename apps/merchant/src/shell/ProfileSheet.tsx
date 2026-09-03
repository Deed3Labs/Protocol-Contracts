import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';
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
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[16px] bg-[var(--clear-surface-2)] px-5 pb-6 pt-3 @[520px]:max-w-[380px] @[520px]:rounded-[16px]">
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-[var(--clear-border-strong)] @[520px]:hidden" />

        {/* Who is on shift, and the way off it. */}
        <div className="mb-4 flex items-center gap-3">
          <Squircle name={staff?.name ?? ''} />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[15px] font-medium">{staff?.name ?? 'Not signed in'}</p>
            <p className="m-0 mt-0.5 text-[11.5px] text-[var(--clear-text-muted)]">
              On shift · {roleLabel}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={18} className="text-[var(--clear-text-secondary)]" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            void signOut();
            onClose();
          }}
          className="mb-5 w-full rounded-[10px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-1)] py-2.5 text-[13px]"
        >
          End shift
        </button>

        {/* A segment, not a toggle: 8am under fluorescents and 8pm are different problems. */}
        <Cap>Appearance</Cap>
        <div className="mb-5 grid grid-cols-3 gap-1.5">
          {(['light', 'dusk', 'dark'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                setAppearance(a);
                applyAppearance(a);
              }}
              className={`rounded-[8px] border-[0.5px] py-2 text-[12.5px] capitalize ${
                appearance === a
                  ? 'border-[var(--clear-text-primary)] bg-[var(--clear-surface-1)]'
                  : 'border-[var(--clear-border)] bg-[var(--clear-surface-1)] text-[var(--clear-text-secondary)]'
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        {canSeeMoney && (
          <>
            <Cap>Shop</Cap>
            <div className="mb-5">
              <SheetLink to="/settings" label="Settings" onClose={onClose} />
              <SheetRow
                label="Your terms"
                value={
                  profile?.discountRate == null
                    ? '—'
                    : `${Math.round(profile.discountRate * 1000) / 10}% · ${profile.payoutTerms ?? 'net-30'}`
                }
              />
              <SheetRow
                label="Cash account"
                value={
                  position?.cashAccountCents == null
                    ? '—'
                    : dollars(fromCents(position.cashAccountCents))
                }
              />
              <SheetLink to="/settings" label="Counter materials" onClose={onClose} />
            </div>
          </>
        )}

        <Cap>This tablet</Cap>
        <div className="mb-5">
          <SheetRow label={device?.label ?? 'Not set up'} value={device ? 'Enrolled' : '—'} />
        </div>

        <SheetLink to="/settings" label="Help" onClose={onClose} />

        {/* Quiet, and last. It is the escalation rather than the default, and under a writer's own
            profile is where an owner looks for it. */}
        {staff?.role !== 'owner' && (
          <Link
            to="/"
            onClick={onClose}
            className="mt-3 block text-center text-[12.5px] text-[var(--clear-text-accent)]"
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

function SheetRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[var(--clear-border)] py-3 text-[13px] last:border-b-0">
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 text-[12.5px] tabular-nums text-[var(--clear-text-muted)]">
        {value}
      </span>
    </div>
  );
}

function SheetLink({ to, label, onClose }: { to: string; label: string; onClose: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClose}
      className="flex items-center justify-between gap-3 border-b-[0.5px] border-[var(--clear-border)] py-3 text-[13px] last:border-b-0"
    >
      <span>{label}</span>
      <ChevronRight size={15} className="shrink-0 text-[var(--clear-text-muted)]" />
    </Link>
  );
}
