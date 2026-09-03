import { useNavigate, useSearchParams } from 'react-router-dom';
import { countsAsVolume, dollars, formatCalendarDate } from '@clear/domain';
import { Columns } from '@/shell/AppShell';
import { Big, Button, Cap, Card, Inset, Lbl, Pill, PrimaryButton, Row } from '@/shell/ui';
import { useAuth } from '@/auth/authContext';
import { api, type MerchantCharge } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import {
  HOME_SCENARIOS,
  STUB_SETUP,
  type HomeStage,
  type SetupTask,
} from '@/data/stubs';

/**
 * Counter home — reference section 01, all three stages.
 *
 * Home is the only screen that has to hold a full tablet at any stage. **The space activity will
 * eventually fill is not left empty in the meantime** — early on it carries setup and training.
 *
 * The stages are not a switch. Each panel stands in for a piece of activity and retires when that
 * activity arrives: the setup list is replaced by the day's charges, the payout explainer by the
 * payout itself, the training panel by the waiting list. Nothing has to be dismissed, and nothing
 * lingers once it is untrue. So the conditions below are written per panel rather than as one
 * `stage` variable — a shop that finishes setup on a busy afternoon should not be waiting for a
 * flag to flip.
 *
 * Only Home needs this. Charges, Payouts, Staff and Settings are lists that either have rows or
 * carry a one-line empty state; they have no hero figure holding open a half-empty screen.
 */

const timeOf = (iso: string) =>
  new Date(iso)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
    .replace(' ', '');

const sinceLabel = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return mins < 1 ? 'just now' : `sent ${mins} min ago`;
};

/** Day one: the left column teaches the flow, because there is no activity to show instead. */
function HowItGoes() {
  return (
    <Inset className="flex-1 !px-4 !py-[15px]">
      <Cap>How it goes</Cap>
      <div className="text-[12.5px] leading-[1.9] text-[var(--clear-text-secondary)]">
        <p className="m-0 mb-[5px]">1 · Type the amount from the ticket.</p>
        <p className="m-0 mb-[5px]">2 · Turn the screen. They scan it.</p>
        <p className="m-0 mb-[5px]">3 · They approve on their phone — here or later.</p>
        <p className="m-0">4 · You are paid on the 14th.</p>
      </div>
    </Inset>
  );
}

/** Replaced by the payout itself, once one has landed. */
function FirstPayoutExplainer({ on }: { on: string }) {
  return (
    <Inset className="flex flex-1 flex-col justify-center !px-4 !py-[15px]">
      <p className="m-0 mb-[7px] text-[13px] font-medium">
        Your first payout is {formatCalendarDate(on)}
      </p>
      <p className="m-0 text-[12.5px] leading-[1.7] text-[var(--clear-text-secondary)]">
        Everything confirmed before then lands together. You can withdraw earlier once there is
        enough in the pool — we will tell you when.
      </p>
    </Inset>
  );
}

function SetupList({ tasks }: { tasks: SetupTask[] }) {
  return (
    <>
      <Cap>Finish setting up</Cap>
      <Card rows className="mb-3.5">
        {tasks.map((t) => (
          <Row
            key={t.id}
            title={
              <span className={t.done ? 'text-[var(--clear-text-muted)]' : undefined}>
                {t.title}
              </span>
            }
            meta={t.detail}
            right={
              t.done ? (
                <span className="text-[11.5px] text-[var(--clear-text-success)]">Done</span>
              ) : (
                <Button className="!px-[11px] !py-1 !text-[12px]">{t.action}</Button>
              )
            }
          />
        ))}
      </Card>

      <Inset className="flex flex-1 flex-col justify-center !px-4 !py-[15px]">
        <p className="m-0 mb-[7px] text-[13px] font-medium">Who to offer it to</p>
        <p className="m-0 text-[12.5px] leading-[1.7] text-[var(--clear-text-secondary)]">
          Anyone whose ticket is over $300.{' '}
          <strong className="font-medium text-[var(--clear-text-primary)]">
            Offer it to everyone above that
          </strong>
          , not only to people who look like they need it — that is both fairer and where the volume
          is.
        </p>
      </Inset>
    </>
  );
}

/**
 * The most valuable tip in the app, and the only one Clear can see.
 *
 * A shop converts when every writer offers it, not when one does. This appears only while it is
 * true and while there is room for it: once the column fills with charges, the activity is the
 * better signal and the tip retires.
 */
function WriterTip({ leader, laggard, count }: { leader: string; laggard: string; count: number }) {
  return (
    <Inset className="flex flex-1 flex-col justify-center !px-4 !py-3.5">
      <p className="m-0 text-[12.5px] leading-[1.7] text-[var(--clear-text-secondary)]">
        <strong className="font-medium text-[var(--clear-text-primary)]">
          {leader} has raised {count === 2 ? 'both' : 'all'} of today's charges.
        </strong>{' '}
        Worth a word with {laggard} — the shops that do well are the ones where every writer offers
        it.
      </p>
    </Inset>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { canSeeMoney } = useAuth();
  const [params] = useSearchParams();

  // Dev-only: the three home states are a designed sequence, and each one is only true for a few
  // days of a real shop's life. `?home=empty|early|running` holds one still so it can be looked at.
  // Statically dropped from a production build.
  const forced =
    import.meta.env.DEV && params.get('home')
      ? (HOME_SCENARIOS[params.get('home') as HomeStage] ?? null)
      : null;

  const { data: charged } = useApi(() => api.charges({ limit: 100 }), []);
  // Both owner-only. `useApi` resolves a 403 to null rather than an error, because a counter writer
  // being refused these is the rule working, not a failure — and the panels below already hide.
  const { data: position } = useApi(() => api.payouts(), []);
  const { data: staff } = useApi(() => api.staff(), []);

  const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
  const charges: MerchantCharge[] = forced
    ? (forced.charges as unknown as MerchantCharge[])
    : (charged ?? []).filter((c) => isToday(c.createdAt));

  const waiting = charges.filter((c) => c.state === 'waiting' || c.state === 'resolving');
  // Financed volume only. Card and balance payments run on ordinary rails and never reach this
  // app, so there is no "paid now" figure and nothing to add it to.
  // Cancelled, declined and expired charges are not money. Counting them told a merchant they
  // had taken more than they had, which is the one direction of wrong they will notice.
  const counted = charges.filter((c) => countsAsVolume(c.state));
  const todayTotal = counted.reduce((sum, c) => sum + c.amount, 0);

  const nextPayout = position?.nextPayoutOn
    ? { scheduledFor: position.nextPayoutOn, amount: position.owedCents / 100 }
    : null;
  const hasHadPayout = forced ? forced.hasHadPayout : (position?.paid.length ?? 0) > 0;

  const setup: SetupTask[] = forced ? forced.setup : STUB_SETUP.map((t) => ({ ...t, done: true }));
  const setupDone = setup.every((t) => t.done);

  // One writer raising everything, with a colleague who is not. True only while it is true — and
  // only computable for an owner, since the roster is money-adjacent and counter staff cannot read
  // it. The tip simply does not appear for them, which is correct: it is an owner's observation.
  const writers = [...new Set(charges.map((c) => c.raisedByStaffId).filter(Boolean))];
  const idle = (staff ?? []).filter(
    (s) => s.role === 'counter' && s.active && !writers.includes(s.id),
  );
  const leader = charges.find((c) => c.raisedByStaffId === writers[0])?.raisedBy ?? '—';
  const showWriterTip =
    charges.length > 0 && charges.length < 4 && writers.length === 1 && idle.length > 0;

  return (
    <Columns
      action={
        <>
          <Lbl>Today</Lbl>
          <div className={charges.length === 0 ? 'text-[var(--clear-text-muted)]' : undefined}>
            <Big>{dollars(todayTotal)}</Big>
          </div>
          <p className="m-0 mb-[18px] mt-[5px] text-[12.5px] text-[var(--clear-text-muted)]">
            {counted.length === 0
              ? 'No charges yet'
              : `${counted.length} charges · ${
                  waiting.length > 0 ? `${waiting.length} waiting on the customer` : 'nothing waiting'
                }`}
          </p>

          <PrimaryButton onClick={() => navigate('/new')} className="mb-[18px]">
            New charge
          </PrimaryButton>

          {/* Each of these stands in for the one below it, and retires when it arrives. */}
          {charges.length === 0 ? (
            <HowItGoes />
          ) : waiting.length === 0 && !hasHadPayout && nextPayout ? (
            <FirstPayoutExplainer on={nextPayout.scheduledFor} />
          ) : (
            <>
              <Cap>Waiting</Cap>
              <Card rows={waiting.length > 0} className="flex-1">
                {waiting.length === 0 ? (
                  <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">Nothing waiting.</p>
                ) : (
                  waiting.map((c) => (
                    <Row
                      key={c.code}
                      title={c.memberName ?? 'Not opened yet'}
                      meta={`${dollars(c.amount)} · ${sinceLabel(c.createdAt)}${
                        c.openedAt ? ' · app opened' : ''
                      }`}
                      right={<Pill tone="pending">Not confirmed</Pill>}
                    />
                  ))
                )}
              </Card>
            </>
          )}
        </>
      }
      context={
        !setupDone ? (
          <SetupList tasks={setup} />
        ) : (
          <>
            <Cap>Today</Cap>
            <Card rows className="mb-3.5">
              {charges.map((c) => (
                <Row
                  key={c.code}
                  title={c.memberName ?? 'Not opened yet'}
                  meta={`${timeOf(c.createdAt)} · ${c.raisedBy ?? '—'}`}
                  right={
                    c.state === 'waiting' || c.state === 'resolving' ? (
                      <Pill tone="pending">Waiting</Pill>
                    ) : c.state === 'approved' ? (
                      <span>{dollars(c.amount)}</span>
                    ) : (
                      // A decline never says why — that is between Clear and the member.
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
                <Card className={`py-[13px] ${showWriterTip ? 'mb-3.5' : ''}`}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px]">
                      {formatCalendarDate(nextPayout.scheduledFor)}
                    </span>
                    <span className="text-[19px] font-medium tabular-nums">
                      {dollars(hasHadPayout ? nextPayout.amount : todayTotal)}
                    </span>
                  </div>
                  <p className="m-0 mt-[5px] text-[11.5px] text-[var(--clear-text-muted)]">
                    Net-30 · may arrive sooner
                  </p>
                </Card>
              </>
            )}

            {showWriterTip && (
              <WriterTip leader={leader} laggard={idle[0].name} count={charges.length} />
            )}
          </>
        )
      }
    />
  );
}
