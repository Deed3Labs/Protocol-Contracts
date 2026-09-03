import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { dollars, formatCalendarDate, payoutSettlement } from '@clear/domain';
import { Cap, Card, Inset, PrimaryButton } from '@/shell/ui';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import { WithdrawModal } from '@/payouts/WithdrawModal';

/**
 * Payouts — reference section 07, with the withdraw flow from section 18.
 *
 * Owed, settling, history. Owner-only: the route is guarded in App, because a counter device is a
 * shared device and a URL somebody typed once is a URL somebody can type again.
 *
 * **The withdraw cap is stated up front.** Hiding a pool limit and then failing the withdrawal is
 * how a merchant stops trusting the app; naming it explains itself before they press anything.
 *
 * **Every payout traces to its charges.** A merchant reconciling against their own books has to
 * get from a bank deposit back to the tickets — without that they will not trust the figure, and
 * they will ask for a spreadsheet every month.
 */

/**
 * The withdraw flow is a modal now — reference section 07b.
 *
 * It was two full-page views, which could not express the thing that actually matters: money comes
 * from one of two places and goes to one of three, and the route between them changes the fee and
 * the timing. A modal that asks both legs keeps the payouts screen as the answer to "where do I
 * stand" rather than making it also be the machinery.
 */
type View = 'summary' | 'withdraw';

/**
 * One line of the composition — reference section 07's `.leg2`.
 *
 * The dot ties the row to its slice of the bar above, which is what makes the two read as one
 * object. The third line is dimmed rather than hidden: money arriving on a date is not money you
 * have, and pretending otherwise is the misstatement the whole two-balance design exists to avoid.
 */
function Leg({
  dot,
  name,
  sub,
  value,
  chevron,
  dim,
}: {
  dot: string;
  name: string;
  sub: string;
  value: string;
  chevron?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between border-b-[0.5px] border-[var(--clear-border)] py-[13px] text-[13.5px] last:border-b-0 ${
        dim ? 'opacity-55' : ''
      }`}
    >
      <span className="flex min-w-0 flex-1 items-start gap-[9px] pr-[14px] leading-[1.25]">
        <i
          style={{ background: dot }}
          className="mt-[5px] block h-[7px] w-[7px] shrink-0 rounded-full"
        />
        <span className="min-w-0">
          <span className="block truncate">{name}</span>
          <span className="mt-1 block text-[11.5px] leading-[1.45] text-[var(--clear-text-muted)]">
            {sub}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-[7px] whitespace-nowrap text-[15px] leading-[1.25] tabular-nums">
        {value}
        {chevron && <ChevronRight size={13} className="text-[var(--clear-text-muted)]" />}
      </span>
    </div>
  );
}

export default function PayoutsPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('summary');

  const { data: position, reload } = useApi(() => api.payouts(), []);
  const { data: profile } = useApi(() => api.profile(), []);

  const owed = (position?.owedCents ?? 0) / 100;
  // Nulls stay null all the way to the screen: an unreadable balance rendered as $0.00 looks like
  // an empty account rather than a failed lookup, and a merchant would act on it.
  const cashAccount = position?.cashAccountCents == null ? null : position.cashAccountCents / 100;
  const releasedReady =
    position?.releasedReadyCents == null ? null : position.releasedReadyCents / 100;
  const scheduled = (position?.scheduledCents ?? 0) / 100;
  const ready = position?.readyToWithdrawCents == null ? null : position.readyToWithdrawCents / 100;
  const clearBalance = (position?.clearsBalanceCents ?? 0) / 100;
  const settle = payoutSettlement(owed, clearBalance);
  const bank = profile?.payoutAccount ?? 'your bank account';
  const nextPayoutOn = position?.nextPayoutOn ?? null;
  const paid = position?.paid ?? [];

  return (
    <>
      {view === 'withdraw' && position && (
        <WithdrawModal
          position={position}
          bankName={profile?.payoutAccount ?? null}
          onClose={() => setView('summary')}
          onDone={reload}
        />
      )}
      <div className="mb-4 grid grid-cols-1 gap-3.5 @[900px]:grid-cols-2">
        <div>
          {/*
            One figure, then where it comes from — reference section 07.

            A merchant thinks "how much can I get right now", so that is the number at the top and
            the subline says when the rest arrives. The composition answers the follow-up — where it
            currently sits — without making them read two cards and do the addition.
          */}
          <p className="m-0 mb-0.5 text-[11px] tracking-[0.3px] text-[var(--clear-text-muted)]">
            Ready to withdraw
          </p>
          <p className="m-0 text-[40px] font-medium leading-[1.05] tracking-[-1.2px] tabular-nums">
            {ready === null ? '—' : dollars(ready)}
          </p>
          <p className="m-0 mb-[14px] mt-[5px] text-[12.5px] text-[var(--clear-text-muted)]">
            {scheduled > 0 && nextPayoutOn
              ? `${dollars(scheduled)} more releases ${formatCalendarDate(nextPayoutOn)}`
              : 'Net-30, and sooner when the pool allows'}
          </p>

          {/*
            The composition bar: one quantity in three states, sized by share.

            It is what makes the three lines beneath it a breakdown rather than a list — the eye
            gets the proportion before it reads a single figure. Flex weights, so it needs no
            percentages and degrades to nothing when every tier is zero.
          */}
          <div className="mb-1 flex h-[7px] gap-[1.5px] overflow-hidden rounded-[4px] bg-[var(--clear-surface-0)]">
            {[
              { v: cashAccount ?? 0, c: 'var(--clear-tier-cash)' },
              { v: releasedReady ?? 0, c: 'var(--clear-tier-free)' },
              { v: scheduled, c: 'var(--clear-tier-locked)' },
            ]
              .filter((t) => t.v > 0)
              .map((t) => (
                <span key={t.c} style={{ flex: t.v, background: t.c }} />
              ))}
          </div>

          <div className="mt-2.5 rounded-[11px] border-[0.5px] border-[var(--clear-border)] px-[14px]">
            <Leg
              dot="var(--clear-tier-cash)"
              name="In your cash account"
              sub="Spendable at partners"
              value={cashAccount === null ? '—' : dollars(cashAccount)}
              chevron
            />
            <Leg
              dot="var(--clear-tier-free)"
              name="Released and ready"
              sub="Free to move today"
              value={releasedReady === null ? 'Nothing today' : dollars(releasedReady)}
            />
            <Leg
              dot="var(--clear-tier-locked)"
              name={nextPayoutOn ? `Releases ${formatCalendarDate(nextPayoutOn)}` : 'Releases later'}
              sub="On your next payout"
              value={dollars(scheduled)}
              dim
            />
          </div>

          <PrimaryButton
            onClick={() => setView('withdraw')}
            disabled={!position}
            className="mt-[14px] !py-[13px] !text-[15px]"
          >
            Withdraw
          </PrimaryButton>
          <p className="m-0 mt-2.5 text-center text-[11.5px] leading-[1.55] text-[var(--clear-text-muted)]">
            Net-30, and sooner when the pool allows
          </p>
        </div>

        <Inset className="mb-[14px] !px-4 !py-[15px]">
          <p className="m-0 mb-[11px] text-[10px] uppercase tracking-[0.5px] text-[var(--clear-text-muted)]">
            How the next payout settles
          </p>
          <div className="flex justify-between text-[13px]">
            <span className="text-[var(--clear-text-secondary)]">Clears your balance</span>
            <span className="tabular-nums">{dollars(settle.clearsBalance)}</span>
          </div>
          <div className="mt-[7px] flex justify-between text-[13px]">
            <span className="text-[var(--clear-text-secondary)]">To your cash account</span>
            <span className="font-medium tabular-nums">{dollars(settle.toBank)}</span>
          </div>
          <p className="m-0 mt-3 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
            You are carrying {dollars(settle.clearsBalance)} on Clear. That clears first — it costs
            you no carry.
          </p>
        </Inset>
      </div>

      <Cap>Paid out</Cap>
      <Card rows={paid.length > 0} className={paid.length > 0 ? "!px-4 !py-0" : ""}>
        {/* Before the first payout lands this card is empty, which is a real and common state for
            a new shop rather than a failure — so it says which date to expect instead of nothing. */}
        {paid.length === 0 && (
          <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">
            {nextPayoutOn
              ? `No payouts yet. Your first lands on ${formatCalendarDate(nextPayoutOn)}.`
              : 'No payouts yet.'}
          </p>
        )}
        {paid.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => navigate(`/payouts/${p.id}`)}
            className="flex w-full items-center justify-between gap-3 border-b-[0.5px] border-[var(--clear-border)] py-3 text-left text-[13px] last:border-b-0"
          >
            <span className="min-w-0">
              <span className="block">{formatCalendarDate(p.on)}</span>
              <span className="mt-0.5 block text-[11.5px] text-[var(--clear-text-muted)]">
                {p.charges} charges · {bank}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{dollars(p.amountCents / 100)}</span>
          </button>
        ))}
      </Card>
      <p className="m-0 mt-[13px] text-[11.5px] text-[var(--clear-text-muted)]">
        Each payout opens to the charges inside it, so any figure can be traced to the jobs that
        produced it.
      </p>
    </>
  );
}
