import { useNavigate } from 'react-router-dom';
import { dollars, formatCalendarDate } from '@clear/domain';
import { Columns } from '@/shell/AppShell';
import { Big, Cap, Card, Inset, Pill, PrimaryButton, Row } from '@/shell/ui';
import { useAuth } from '@/auth/authContext';
import { STUB_CHARGES, STUB_PAYOUTS, STUB_STAFF, waitingCharges } from '@/data/stubs';

/**
 * Counter home — the "running" state.
 *
 * Today's financed total leads, because it is the one figure a writer glances at between customers.
 * Under it the only action, then what is still open. The right column is the day's activity and
 * the next payout: context, not tasks.
 *
 * The three states proper — empty, early, running — are Phase 4, section 1. This is the running
 * one, built to the reference so the shell it sits in is right.
 */

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();

const staffName = (id: string) => STUB_STAFF.find((s) => s.id === id)?.name ?? '—';

function sinceLabel(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return mins < 1 ? 'just now' : `${mins} min ago`;
}

export default function HomePage() {
  const navigate = useNavigate();
  const { canSeeMoney } = useAuth();

  const waiting = waitingCharges();
  // Financed volume only. Card and balance payments run on ordinary rails and are not in any total
  // on this screen — there is no "paid now" figure to add, by design.
  const todayTotal = STUB_CHARGES.reduce((sum, c) => sum + c.amount, 0);
  const nextPayout = STUB_PAYOUTS.find((p) => p.status === 'scheduled');

  return (
    <Columns
      action={
        <>
          <Cap>Today</Cap>
          <Big>{dollars(todayTotal)}</Big>
          <p className="m-0 mb-[18px] mt-1.5 text-[12.5px] text-[var(--clear-text-muted)]">
            {STUB_CHARGES.length} charges
            {waiting.length > 0 && ` · ${waiting.length} waiting on the customer`}
          </p>

          <PrimaryButton onClick={() => navigate('/new')} className="mb-[18px]">
            New charge
          </PrimaryButton>

          <Cap>Waiting</Cap>
          {waiting.length === 0 ? (
            <Card className="py-3.5">
              <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">Nothing waiting.</p>
            </Card>
          ) : (
            <Card>
              {waiting.map((c) => (
                <Row
                  key={c.id}
                  title={c.member?.displayName ?? 'Not opened yet'}
                  meta={`${dollars(c.amount)} · sent ${sinceLabel(c.createdAt)}${
                    c.openedAt ? ' · app opened' : ''
                  }`}
                  right={<Pill tone="pending">Not confirmed</Pill>}
                />
              ))}
            </Card>
          )}
        </>
      }
      context={
        <>
          <Cap>Today</Cap>
          <Card className="mb-3.5">
            {STUB_CHARGES.map((c) => (
              <Row
                key={c.id}
                title={c.member?.displayName ?? 'Not opened yet'}
                meta={`${timeOf(c.createdAt)} · ${staffName(c.raisedByStaffId)}`}
                right={
                  c.state === 'waiting' || c.state === 'resolving' ? (
                    <Pill tone="pending">Waiting</Pill>
                  ) : c.state === 'approved' ? (
                    <span>{dollars(c.amount)}</span>
                  ) : (
                    // Declined never says why, and expired says only that it lapsed.
                    <Pill>{c.state === 'expired' ? 'Expired' : 'Declined'}</Pill>
                  )
                }
              />
            ))}
          </Card>

          {/* Payout figures are owner-only: counter staff never see them. */}
          {canSeeMoney && nextPayout && (
            <>
              <Cap>Next payout</Cap>
              <Card className="mb-3.5 py-3.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px]">
                    {formatCalendarDate(nextPayout.scheduledFor)}
                  </span>
                  <span className="text-[19px] font-medium tabular-nums">
                    {dollars(nextPayout.amount)}
                  </span>
                </div>
                <p className="m-0 mt-1.5 text-[11.5px] text-[var(--clear-text-muted)]">
                  Net-30 · may arrive sooner
                </p>
              </Card>
            </>
          )}

          <Inset className="flex-1">
            <p className="m-0 text-[12.5px] leading-[1.7] text-[var(--clear-text-secondary)]">
              <strong className="font-medium text-[var(--clear-text-primary)]">
                Financed charges only.
              </strong>{' '}
              A member paying from their balance or tapping a Clear card runs on ordinary payment
              rails and never appears here.
            </p>
          </Inset>
        </>
      }
    />
  );
}
