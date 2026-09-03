import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dollars, formatCalendarDate, payoutSettlement } from '@clear/domain';
import { Big, Cap, Card, Inset, Lbl, PrimaryButton, Row } from '@/shell/ui';
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
          <Lbl>Ready to withdraw</Lbl>
          <Big>{ready === null ? '—' : dollars(ready)}</Big>
          <p className="m-0 mb-[18px] mt-[5px] text-[12.5px] text-[var(--clear-text-muted)]">
            {scheduled > 0 && nextPayoutOn
              ? `${dollars(scheduled)} more releases ${formatCalendarDate(nextPayoutOn)}`
              : 'Net-30, and sooner when the pool allows'}
          </p>

          {/*
            Three parallel lines — all states of the same money, rather than one account and two
            conditions. "Still lent out" was wrong and is gone: that money is not on loan, it is
            owed and simply beyond what the pool can free today, so the line names the date.
          */}
          <Card rows className="mb-3.5">
            <Row
              title="In your cash account"
              right={
                <span className="tabular-nums">
                  {cashAccount === null ? '—' : dollars(cashAccount)}
                </span>
              }
            />
            <Row
              title="Released and ready"
              right={
                <span className="tabular-nums">
                  {releasedReady === null ? 'Nothing today' : dollars(releasedReady)}
                </span>
              }
            />
            <Row
              title={nextPayoutOn ? `Releases ${formatCalendarDate(nextPayoutOn)}` : 'Releases on your next payout'}
              right={<span className="tabular-nums">{dollars(scheduled)}</span>}
            />
          </Card>

          {/*
            Opens whenever the position has loaded, including at nothing.
            
            A dead button tells a merchant nothing about why. The modal already knows both caps and
            says which is in force — "we cannot size an early release just now", "all of your cash
            account" — so letting it open is the more informative refusal, and the submit inside it
            is still guarded.
          */}
          <PrimaryButton
            onClick={() => setView('withdraw')}
            disabled={!position}
            className="mb-[9px] !py-3.5 !text-[15px]"
          >
            Withdraw
          </PrimaryButton>
          <p className="m-0 text-center text-[11.5px] text-[var(--clear-text-muted)]">
            Net-30, and sooner when the pool allows
          </p>
        </div>

        <Inset className="!px-4 !py-[15px]">
          <Cap>How this settles</Cap>
          <div className="flex justify-between text-[13px]">
            <span className="text-[var(--clear-text-secondary)]">Clears your balance</span>
            <span className="tabular-nums">{dollars(settle.clearsBalance)}</span>
          </div>
          <div className="mt-[7px] flex justify-between text-[13px]">
            <span className="text-[var(--clear-text-secondary)]">To your bank</span>
            <span className="font-medium tabular-nums">{dollars(settle.toBank)}</span>
          </div>
          <p className="m-0 mt-3 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
            You are carrying {dollars(settle.clearsBalance)} on Clear. That clears first — it costs
            you no carry.
          </p>
        </Inset>
      </div>

      <Cap>Paid out</Cap>
      <Card rows={paid.length > 0}>
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
