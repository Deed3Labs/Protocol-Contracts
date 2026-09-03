import { useEffect, useState } from 'react';
import { Columns } from '@/shell/AppShell';
import { canChangePayoutAccount, dollars, fromCents } from '@clear/domain';
import { Button, Cap, Card, Chip, Row } from '@/shell/ui';
import { useAuth } from '@/auth/authContext';
import { api, type EnrolledDevice } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import {
  STUB_LISTING,
  STUB_NOTIFICATIONS,
  STUB_TERMS,
} from '@/data/stubs';

/**
 * Settings — reference section 09.
 *
 * One page with sections, not a rail. A merchant has few settings and visits them rarely; a nav
 * would be more structure than content.
 *
 * **Terms are shown but not editable.** They live in the signed agreement. A settings page that
 * lets a merchant change their own rate is a settings page that will be used to change their own
 * rate — so there is nothing to edit here, and the copy says why.
 *
 * Counter staff see almost none of this: the rate, the bank and the terms are all money. What is
 * left for them is the device itself, which is why signing out lives here.
 *
 * One discrepancy with the drawing, flagged rather than resolved by guesswork. The reference lists
 * "Rate 2% · for life", but every screen that does arithmetic uses 2.5% — $23.50 on $940, $10.30
 * on $412, $401.70 paid out — and those figures are asserted in the domain's tests. The rate is
 * rendered from the merchant record so it agrees with the money; if 2% is the real term, changing
 * `discountRate` corrects all of it at once.
 */
/** "Mike's Tire" → "MT". Derived rather than stored: a shop that renames itself keeps a matching mark. */
function initials(name: string | undefined): string {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function SettingsPage() {
  const { session, device, canSeeMoney } = useAuth();
  const { data: profile } = useApi(() => api.profile(), []);

  // The rate is rendered from the merchant record so it agrees with the money on every other
  // screen. `forDisplay` reads it from the chain and falls back to the stored copy, so a Settings
  // page never asserts a rate the arithmetic disagrees with. Em dash while it loads rather than a
  // zero, which would be a wrong number rather than a missing one.
  const rate = profile?.discountRate;
  const ratePercent = rate == null ? null : Math.round(rate * 1000) / 10;
  const cap = profile?.approvalCapCents;

  return (
    <Columns
      action={
        <>
          {canSeeMoney && (
            <>
              <Cap>Your terms</Cap>
              <Card rows className="mb-4 !px-4 !py-0">
                <Row
                  title={<span className="text-[var(--clear-text-secondary)]">Rate</span>}
                  right={
                    <span>
                      {ratePercent === null ? '—' : `${ratePercent}%`}
                      {STUB_TERMS.rateForLife ? ' · for life' : ''}
                    </span>
                  }
                />
                <Row
                  title={<span className="text-[var(--clear-text-secondary)]">Payout</span>}
                  right={<span>{profile?.payoutTerms ?? '—'}</span>}
                />
                <Row
                  title={<span className="text-[var(--clear-text-secondary)]">Approval cap</span>}
                  right={
                    <span>{cap == null ? '—' : `${dollars(fromCents(cap))} per charge`}</span>
                  }
                />
                <Row
                  title={<span className="text-[var(--clear-text-secondary)]">Partner since</span>}
                  right={
                    <span>
                      {profile?.partnerSince ?? '—'}
                      {profile?.founding ? ' · founding' : ''}
                    </span>
                  }
                />
              </Card>
              <p className="m-0 mb-4 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
                Terms are set in your agreement. To change one, talk to us — there is nothing to
                edit here.
              </p>

              <Cap>Where payouts go</Cap>
              <Card rows className="mb-4 !px-4 !py-0">
                <Row
                  title={profile?.payoutAccount ?? 'No account yet'}
                  meta="Business checking"
                  right={
                    // Owner only, and shown as such rather than hidden: a manager should be able to
                    // see where payouts land without being able to send them somewhere else.
                    canChangePayoutAccount(session?.staff.role ?? 'counter') ? (
                      <Button className="!px-[11px] !py-1 !text-[12px]">Change</Button>
                    ) : (
                      <span className="text-[11.5px] text-[var(--clear-text-muted)]">Owner only</span>
                    )
                  }
                />
              </Card>
            </>
          )}

          {/* Signing out and which shift is running moved to the profile sheet in section 21 —
              they are not settings, they are who is on the counter right now. The tablet LIST
              stays: section 19 promises removal from Settings, from any device. */}
          {canSeeMoney && <EnrolledDevices currentId={device?.id ?? null} />}
        </>
      }
      context={
        <>
          {/* The artefact that makes the waiting-room path work, which is why it is here rather
              than buried in a menu — a merchant should be able to reorder without asking. */}
          <Cap>Counter materials</Cap>
          <Card className="mb-4 !py-[15px]">
            <p className="m-0 mb-3 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
              The printed card carries the same code as this tablet. Send it home with an estimate
              and they can sign up while they wait.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1 !text-[12px]">Print counter cards</Button>
              <Button className="flex-1 !text-[12px]">Order more</Button>
            </div>
          </Card>

          {canSeeMoney && (
            <>
              <Cap>Notifications</Cap>
              <Card rows className="mb-4 !px-4 !py-0">
                {STUB_NOTIFICATIONS.map((n) => (
                  <Row
                    key={n.id}
                    title={<span className="text-[var(--clear-text-secondary)]">{n.label}</span>}
                    right={
                      <span className="text-[11.5px] text-[var(--clear-text-muted)]">
                        {n.on ? 'On' : 'Off'}
                      </span>
                    }
                  />
                ))}
              </Card>

              <Cap>How members see you</Cap>
              <Card className="mb-4 !py-[15px]">
                <div className="mb-3 flex items-center gap-[11px]">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--clear-bg-success)] text-[11.5px] text-[var(--clear-text-success)]">
                    {initials(profile?.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="m-0 text-[13px]">{profile?.name ?? 'Your shop'}</p>
                    <p className="m-0 mt-0.5 text-[11.5px] text-[var(--clear-text-muted)]">
                      {profile?.category ?? STUB_LISTING.category} ·{' '}
                      {profile?.town ?? STUB_LISTING.town}
                    </p>
                  </div>
                  {STUB_LISTING.creditTag && (
                    <span className="ml-auto shrink-0">
                      <Chip tone="accent">Credit</Chip>
                    </span>
                  )}
                </div>
                <p className="m-0 mb-3 text-[11.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
                  Your entry in the Clear Partners directory, where members look for somewhere to
                  spend. The{' '}
                  <strong className="font-medium text-[var(--clear-text-primary)]">Credit</strong>{' '}
                  tag marks you as a shop where they can split a purchase.
                </p>
                <Button className="w-full !text-[12px]">Edit listing</Button>
              </Card>

              {/* Small and deliberate: the one place the co-op is stated plainly, away from the
                  counter where it would only slow a sale down. */}
              <Cap>Your membership</Cap>
              <Card className="!py-[15px]">
                <p className="m-0 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
                  {profile?.name ?? 'Your shop'} is a partner member of the Clear co-op. One member, one vote
                  — the same as every other member.
                </p>
              </Card>
            </>
          )}
        </>
      }
    />
  );
}

/**
 * Every tablet this shop has — reference section 19.
 *
 * "Remove it any time, from any device" is the sentence that makes a lost tablet survivable, and
 * it is only true if this list exists somewhere an owner can reach on their phone. Revoking writes
 * one row server-side and takes effect on that tablet's very next request; it does not wait for a
 * session to expire.
 *
 * Removed tablets stay on the list, greyed. An owner asking "what was that one we lost in March"
 * deserves an answer, and a list that silently forgets is a list that cannot be audited.
 */
function EnrolledDevices({ currentId }: { currentId: string | null }) {
  const [devices, setDevices] = useState<EnrolledDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.devices().then(setDevices).catch(() => setDevices([]));
  }, []);

  async function remove(id: string) {
    setBusy(id);
    try {
      await api.revokeDevice(id);
      setDevices(await api.devices());
    } catch {
      // Left on screen unchanged rather than half-updated: an owner who thinks they revoked a
      // tablet that is still live is worse off than one who sees it did not work and retries.
    } finally {
      setBusy(null);
    }
  }

  if (!devices || devices.length === 0) return null;

  return (
    <>
      <Cap>Tablets</Cap>
      <Card rows className="!px-4 !py-0">
        {devices.map((d) => (
          <Row
            key={d.id}
            title={
              <span className={d.revokedAt ? 'text-[var(--clear-text-muted)] line-through' : ''}>
                {d.label}
              </span>
            }
            meta={
              d.revokedAt
                ? 'Removed'
                : d.id === currentId
                  ? 'This tablet'
                  : d.enrolledByName
                    ? `Set up by ${d.enrolledByName}`
                    : 'Enrolled'
            }
            right={
              d.revokedAt ? null : (
                <Button
                  onClick={() => remove(d.id)}
                  className="!px-[11px] !py-1 !text-[12px]"
                >
                  {busy === d.id ? 'Removing…' : 'Remove'}
                </Button>
              )
            }
          />
        ))}
      </Card>
    </>
  );
}
