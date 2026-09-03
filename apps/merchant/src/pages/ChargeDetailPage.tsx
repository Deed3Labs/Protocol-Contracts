import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import {
  CHARGE_LABEL,
  canTransition,
  dollars,
  formatCalendarDate,
  isPending,
  merchantFee,
  merchantPayout,
  splitQuote,
} from '@clear/domain';
import { Button, Inset } from '@/shell/ui';
import { useAuth } from '@/auth/authContext';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import { STUB_MERCHANT } from '@/data/stubs';

/**
 * Charge detail — reference section 15.
 *
 * Refunds are unavoidable in retail — wrong tyre, returned part, job cancelled — and a merchant
 * asks about them in the first conversation. So the entry point lives here, on the charge itself.
 *
 * **"Start a refund", never "Refund".** The label has to tell a writer they are beginning
 * something rather than doing it. Any staff member can start one; an owner finishes it. A writer
 * who reads the button as the whole act promises a customer a refund and then discovers they
 * cannot complete it, which is the worst conversation at a counter.
 *
 * The money block is owner-only. The reference draws the owner's view; counter staff never see
 * payout figures, the fee or the rate, so for them the screen is the charge and the plan without
 * the economics.
 */

export default function ChargeDetailPage() {
  const { id } = useParams();
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { session, canSeeMoney } = useAuth();

  // No single-charge endpoint: the list is what the tablet already reads, and a shop's day is
  // small enough that finding the row in it costs less than another route. Hooks run before the
  // guard below, which is why the fetch is not conditional on having found anything.
  const { data: charges, loading } = useApi(() => api.charges({ limit: 200 }), []);
  const { data: profile } = useApi(() => api.profile(), []);

  const charge = (charges ?? []).find((c) => c.code === id);

  if (loading && !charge) {
    return <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">Loading…</p>;
  }
  if (!charge) return <Navigate to="/charges" replace />;

  const rate = profile?.discountRate ?? null;
  // The carry rate is a Clear product parameter rather than a merchant term, so it is not on the
  // profile endpoint. Still a fixture until it is exposed somewhere honest.
  const plan = charge.splitInto === null ? null : { splitInto: charge.splitInto };
  const quote = plan ? splitQuote(charge.amount, plan.splitInto, STUB_MERCHANT.ratePerCycle) : null;

  const resolvedOn = charge.resolvedAt ?? charge.createdAt;
  const when = new Date(resolvedOn);
  const today = when.toDateString() === new Date().toDateString();
  const timeLabel = when
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
    .replace(' ', '');

  // Counter staff may cancel a charge they raised themselves, while it is still waiting. An owner
  // may cancel any. The lifecycle decides whether cancelling is possible at all.
  const cancellable =
    canTransition(charge.state, 'cancelled') &&
    (canSeeMoney || charge.raisedByStaffId === session?.staff.id);

  const refundable = canTransition(charge.state, 'refund_requested');

  return (
    <div className="mx-auto w-full max-w-[400px]">
      <div className="mb-4 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => navigate('/charges')}
          aria-label="Back"
          className="text-[var(--clear-text-secondary)]"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="text-[16px] font-medium">
          {charge.memberName ?? 'Not opened yet'}
        </span>
      </div>

      <p className="m-0 mb-[3px] text-[26px] font-medium tabular-nums">{dollars(charge.amount)}</p>
      <p className="m-0 mb-[18px] text-[12.5px] text-[var(--clear-text-muted)]">
        {CHARGE_LABEL[charge.state]} {today ? 'today' : formatCalendarDate(resolvedOn)}, {timeLabel}{' '}
        · raised by {charge.raisedBy ?? '—'}
      </p>

      {/* Payout figures, the fee and the rate are owner-only. */}
      {canSeeMoney ? (
        <Inset className="mb-3.5 !px-4 !py-3.5">
          <div className="flex justify-between text-[13px]">
            <span className="text-[var(--clear-text-secondary)]">You receive</span>
            <span className="font-medium tabular-nums">
              {/* The server already computed this for owners, and it is the figure of record.
                  Computing it again here would be a second source of truth for the same money. */}
              {charge.payout !== undefined
                ? dollars(charge.payout)
                : rate === null
                  ? '—'
                  : dollars(merchantPayout(charge.amount, rate))}
            </span>
          </div>
          <div className="mt-[7px] flex justify-between text-[13px]">
            <span className="text-[var(--clear-text-secondary)]">Fee</span>
            <span className="tabular-nums">
              {rate === null
                ? '—'
                : `${dollars(merchantFee(charge.amount, rate))} · ${Math.round(rate * 1000) / 10}%`}
            </span>
          </div>
          <div className="mt-[7px] flex justify-between text-[13px]">
            <span className="text-[var(--clear-text-secondary)]">Paid out</span>
            <span>{charge.state === 'approved' ? formatCalendarDate('2026-12-14') : '—'}</span>
          </div>
          {plan && quote && (
            <div className="mt-[7px] flex justify-between gap-3 border-t-[0.5px] border-[var(--clear-border)] pt-[9px] text-[13px]">
              <span className="text-[var(--clear-text-secondary)]">They chose</span>
              <span className="text-right">
                {/* How many cycles the member has already cleared is not on the merchant's charge
                    feed, and it is the member's repayment progress rather than the shop's business.
                    The plan and the per-cycle figure are the parts that describe this sale. */}
                {plan.splitInto === 1 ? 'In full' : `Split in ${plan.splitInto}`} ·{' '}
                <span className="tabular-nums">{dollars(quote.perCycle)}</span> a cycle
              </span>
            </div>
          )}
        </Inset>
      ) : (
        plan && (
          <Inset className="mb-3.5 !px-4 !py-3.5">
            <div className="flex justify-between gap-3 text-[13px]">
              <span className="text-[var(--clear-text-secondary)]">They chose</span>
              <span className="text-right">
                {plan.splitInto === 1 ? 'In full' : `Split in ${plan.splitInto}`}
              </span>
            </div>
          </Inset>
        )
      )}

      {refundable && (
        <>
          {/* Never "Refund". The writer is beginning something, not completing it. */}
          <Button onClick={() => navigate(`/charges/${charge.code}/refund`)} className="w-full">
            Start a refund
          </Button>
          <p className="m-0 mt-2.5 text-center text-[11.5px] leading-[1.55] text-[var(--clear-text-muted)]">
            Any staff member can start one. An owner finishes it.
          </p>
        </>
      )}

      {cancellable && (
        <>
          <Button
            disabled={cancelling}
            onClick={async () => {
              // This navigated and nothing else, so a cancelled charge stayed live and the
              // customer could still approve it. The server decides whether it is too late.
              setCancelling(true);
              setCancelError(null);
              try {
                await api.cancelCharge(charge.code);
                navigate('/charges');
              } catch (e) {
                setCancelError(
                  e instanceof Error ? e.message : 'That could not be cancelled just now.',
                );
              } finally {
                setCancelling(false);
              }
            }}
            className="mt-2 w-full"
          >
            {cancelling ? 'Cancelling…' : 'Cancel charge'}
          </Button>
          {cancelError && (
            <p role="alert" className="m-0 mt-2 text-center text-[12.5px] leading-[1.5]">
              {cancelError}
            </p>
          )}
        </>
      )}

      {isPending(charge.state) && (
        <p className="m-0 mt-2.5 text-center text-[11.5px] text-[var(--clear-text-muted)]">
          They can approve any time today.
        </p>
      )}
    </div>
  );
}
