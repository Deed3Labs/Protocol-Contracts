import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dollars, formatCalendarDate, payoutSettlement } from '@clear/domain';
import { Big, Button, Cap, Card, Inset, Lbl, PrimaryButton } from '@/shell/ui';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';

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

type View = 'summary' | 'withdraw' | 'withdrawn';

export default function PayoutsPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('summary');
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestedCents, setRequestedCents] = useState(0);

  const { data: position } = useApi(() => api.payouts(), []);
  const { data: profile } = useApi(() => api.profile(), []);

  const owed = (position?.owedCents ?? 0) / 100;
  const clearBalance = (position?.clearsBalanceCents ?? 0) / 100;
  // Null means the pool cap is not known yet, which is not the same as nothing being available.
  // Withdrawing is hidden rather than offered at zero — see the guard on the button.
  const availableToday =
    position?.availableTodayCents == null ? null : position.availableTodayCents / 100;
  const settle = payoutSettlement(owed, clearBalance);
  const bank = profile?.payoutAccount ?? 'your bank account';
  const nextPayoutOn = position?.nextPayoutOn ?? null;
  // "the 14th" is the shop's whole mental model of Clear, so where a sentence is built around the
  // date it stays a sentence when there is no date yet rather than rendering "Invalid Date".
  const payoutDay = nextPayoutOn ? formatCalendarDate(nextPayoutOn) : 'your next payout date';
  const paid = position?.paid ?? [];

  if (view === 'withdraw') {
    return (
      <div className="mx-auto w-full max-w-[340px]">
        <Cap>Withdraw</Cap>
        <p className="m-0 mb-3 text-[12.5px] text-[var(--clear-text-secondary)]">To {bank}</p>
        <p className="m-0 mb-[3px] text-[26px] font-medium tabular-nums">
          {availableToday === null ? '—' : dollars(availableToday)}
        </p>
        <p className="m-0 mb-3.5 text-[11.5px] text-[var(--clear-text-muted)]">
          Available today of {dollars(settle.toBank)} owed
        </p>

        <Inset className="mb-3.5 !px-3.5 !py-3">
          <p className="m-0 text-[12px] leading-[1.6] text-[var(--clear-text-secondary)]">
            The rest lands on {payoutDay} as usual. Withdrawing early does
            not change your rate.
          </p>
        </Inset>

        <PrimaryButton
          disabled={requesting || availableToday === null || availableToday <= 0}
          className="mb-2 !py-[11px] !text-[15px]"
          onClick={async () => {
            setRequesting(true);
            setRequestError(null);
            try {
              const cents = Math.round((availableToday ?? 0) * 100);
              // Interim: the source/destination picker from section 07b replaces this next.
              await api.requestWithdrawal({ amountCents: cents, source: 'owed', destination: 'bank' });
              setRequestedCents(cents);
              setView('withdrawn');
            } catch (e) {
              setRequestError(
                e instanceof Error ? e.message : 'That could not be requested just now.',
              );
            } finally {
              setRequesting(false);
            }
          }}
        >
          {requesting ? 'Requesting…' : `Withdraw ${availableToday === null ? '—' : dollars(availableToday)}`}
        </PrimaryButton>
        {requestError && (
          <p role="alert" className="m-0 mb-2 text-center text-[12.5px] leading-[1.5]">
            {requestError}
          </p>
        )}
        <Button onClick={() => setView('summary')} className="w-full">
          {nextPayoutOn ? `Wait for the ${new Date(nextPayoutOn).getUTCDate()}th` : 'Wait for the next payout'}
        </Button>
      </div>
    );
  }

  if (view === 'withdrawn') {
    return (
      <div className="mx-auto w-full max-w-[340px]">
        <Cap>On its way</Cap>
        <p className="m-0 mb-[3px] text-[26px] font-medium tabular-nums">
          {dollars(requestedCents / 100)}
        </p>
        <p className="m-0 mb-3.5 text-[12.5px] text-[var(--clear-text-muted)]">To {bank}</p>
        <Inset className="mb-3.5 !px-3.5 !py-3">
          <p className="m-0 text-[12px] leading-[1.6] text-[var(--clear-text-secondary)]">
            {/* Specific about what has happened, because "on its way" on its own would be a claim
                about a transfer rather than about a request Clear has accepted. */}
            Requested. Clear settles early withdrawals to the account on file. The rest lands on{' '}
            {payoutDay} as usual.
          </p>
        </Inset>
        <Button onClick={() => setView('summary')} className="w-full">
          Done
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3.5 @[900px]:grid-cols-2">
        <div>
          <Lbl>Owed to you</Lbl>
          <Big>{dollars(owed)}</Big>
          <p className="m-0 mb-[18px] mt-[5px] text-[12.5px] text-[var(--clear-text-muted)]">
            {nextPayoutOn ? `Next payout ${formatCalendarDate(nextPayoutOn)} · net-30` : 'Next payout · net-30'}
          </p>

          <PrimaryButton
            onClick={() => setView('withdraw')}
            // Disabled while the cap is unknown as well as while it is nothing: offering a
            // withdrawal Clear cannot size yet is a button that fails after the tap.
            disabled={availableToday === null || availableToday <= 0}
            className="mb-[9px] !py-3.5 !text-[15px]"
          >
            Withdraw now
          </PrimaryButton>
          {/* The cap, before they press anything rather than after it fails. */}
          <p className="m-0 text-center text-[11.5px] text-[var(--clear-text-muted)]">
            Available today: {availableToday === null ? '—' : dollars(availableToday)} of{' '}
            {dollars(settle.toBank)}
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
