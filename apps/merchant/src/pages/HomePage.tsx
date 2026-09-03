import { useNavigate } from 'react-router-dom';
import { dollars, formatCalendarDate } from '@clear/domain';
import { Columns } from '@/shell/AppShell';
import { Big, Cap, Card, Lbl, Pill, PrimaryButton, Row } from '@/shell/ui';
import { useAuth } from '@/auth/authContext';
import { STUB_CHARGES, STUB_PAYOUTS, STUB_STAFF, waitingCharges } from '@/data/stubs';

/**
 * Counter home — the "running" state, transcribed from the reference.
 *
 * Left: today's financed total, what it is made of, the one action, then what is still open.
 * Right: the day's activity and the next payout. Context, not tasks.
 *
 * The total is financed volume only. A member paying from their balance or tapping a Clear card
 * runs on ordinary payment rails and never reaches this app, so there is no "paid now" figure and
 * nothing to add it to.
 *
 * The three states — empty, early, running — are Phase 4, section 1. This is the running one,
 * built first so the shell around it can be held against the drawing.
 */

const timeOf = (iso: string) =>
  new Date(iso)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
    .replace(' ', '');

const staffName = (id: string) => STUB_STAFF.find((s) => s.id === id)?.name ?? '—';

const sinceLabel = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return mins < 1 ? 'just now' : `sent ${mins} min ago`;
};

export default function HomePage() {
  const navigate = useNavigate();
  const { canSeeMoney } = useAuth();

  const waiting = waitingCharges();
  const todayTotal = STUB_CHARGES.reduce((sum, c) => sum + c.amount, 0);
  const nextPayout = STUB_PAYOUTS.find((p) => p.status === 'scheduled');

  return (
    <Columns
      action={
        <>
          <Lbl>Today</Lbl>
          <Big>{dollars(todayTotal)}</Big>
          <p className="m-0 mb-[18px] mt-[5px] text-[12.5px] text-[var(--clear-text-muted)]">
            {STUB_CHARGES.length} charges
            {waiting.length > 0 && ` · ${waiting.length} waiting on the customer`}
          </p>

          <PrimaryButton onClick={() => navigate('/new')} className="mb-[18px]">
            New charge
          </PrimaryButton>

          <Cap>Waiting</Cap>
          {waiting.length === 0 ? (
            <Card className="flex-1">
              <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">Nothing waiting.</p>
            </Card>
          ) : (
            <Card rows className="flex-1">
              {waiting.map((c) => (
                <Row
                  key={c.id}
                  title={c.member?.displayName ?? 'Not opened yet'}
                  meta={`${dollars(c.amount)} · ${sinceLabel(c.createdAt)}${
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
          <Card rows className="mb-3.5">
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
                    // A decline never says why — that is the member's business, and a writer who
                    // knows the reason will repeat it out loud.
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
              <Card className="py-[13px]">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px]">
                    {formatCalendarDate(nextPayout.scheduledFor)}
                  </span>
                  <span className="text-[19px] font-medium tabular-nums">
                    {dollars(nextPayout.amount)}
                  </span>
                </div>
                <p className="m-0 mt-[5px] text-[11.5px] text-[var(--clear-text-muted)]">
                  Net-30 · may arrive sooner
                </p>
              </Card>
            </>
          )}
        </>
      }
    />
  );
}
