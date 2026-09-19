import { useEffect, useState } from 'react';
import Modal from './Modal';
import BigAmount from './brand/BigAmount';
import { Btn, Line, Rows } from './brand/anatomy';
import { money } from '@clear/domain';
import type { CashAccount, TermPlan } from '@/lib/clearModel';
import { cn } from '@/lib/utils';
import { AlertMark, Steps, Tick } from './MoveProgress';
import { stepsFor, type MoveStatus } from '@/lib/moveSteps';
import { shortMoveReason } from '@/hooks/usePoolMove';

type PayResult = { repaid?: number; error?: string };

/**
 * A term plan, opened from Term plans: where it stands, and paying it.
 *
 * Paying names the plan, so the money services this plan's schedule and nothing else -- unlike a
 * Repay, which reaches every balance dearest first. Next payment is what keeps the plan on schedule
 * through its next due date (anything behind, plus the next installment); Pay it off clears it,
 * carry to the second included. Change split re-spreads what is left and lives one tap further in.
 */
export default function TermPlanDialog({
  plan,
  account,
  open,
  onOpenChange,
  onPay,
  onChangeSplit,
  savingsFree = 0,
}: {
  plan: TermPlan;
  /** Paid from Ready to allocate, the member's USDC. */
  account: CashAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pays on chain. Absent in the preview harness, where the button stays inert. */
  onPay?: (amount: number, payoff: boolean, fromSavings: boolean, onStep?: (step: number) => void) => Promise<PayResult>;
  onChangeSplit: () => void;
  /**
   * Savings free to move -- not pledged against drawn credit. Offered as a source so a member can
   * keep a plan out of default with money they have; never taken without them choosing it.
   */
  savingsFree?: number;
}) {
  const owed = plan.owed ?? 0;
  const next = Math.min(plan.nextPayment ?? 0, owed);
  const behind = plan.behind ?? 0;
  const [fromSavings, setFromSavings] = useState(false);
  const source = fromSavings ? savingsFree : account.readyToAllocate;

  const opening = next > 0 ? next : owed;
  const [amount, setAmount] = useState(opening);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  /*
   * Paying replaces the sheet's content, as moving money and buying a bond do: three named steps
   * while it happens, then what happened. The amount and source are held so the done screen and a
   * retry describe the payment that was made, not whatever the form now says.
   */
  const [progress, setProgress] = useState<{
    status: MoveStatus;
    step: number;
    paid: number;
    fromSavings: boolean;
    stillOwed: number;
    failureNote?: string;
  } | null>(null);

  // Reopening after the numbers moved should not show last time's amount or result.
  useEffect(() => {
    if (!open) return;
    setAmount(opening);
    setCustom(false);
    setNote(null);
    setFromSavings(false);
    setProgress(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const capped = Math.min(Math.max(0, amount), owed);
  const payoff = capped >= owed;
  const stillOwed = Math.max(0, owed - capped);
  const behindAfter = Math.max(0, behind - capped);

  const pay = async () => {
    if (!onPay || capped <= 0) return;
    setBusy(true);
    setNote(null);
    const base = { paid: capped, fromSavings, stillOwed };
    setProgress({ status: 'processing', step: 0, ...base });
    const result = await onPay(capped, payoff, fromSavings, (step) =>
      setProgress((p) => (p && p.status === 'processing' ? { ...p, step } : p)),
    );
    setBusy(false);
    if (result.repaid && result.repaid > 0) {
      // Paid on chain. A recording that lagged is not a failed payment; the books catch up on read.
      setProgress({ status: 'done', step: 3, ...base, paid: result.repaid });
    } else {
      setProgress({
        status: 'failed',
        step: 1,
        ...base,
        failureNote: shortMoveReason(result.error ?? 'it did not go through'),
      });
    }
  };

  if (progress) {
    const labels = [
      progress.fromSavings ? 'Taken from your savings' : 'Taken from your cash account',
      `Paid to ${plan.name}`,
      'Added to your activity',
    ];
    const from = progress.fromSavings ? 'savings' : 'cash account';
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={plan.name}
        // Done clears the title: the hero says what happened.
        titleHidden={progress.status === 'done'}
        description="Paying this plan."
        footer={
          progress.status === 'processing' ? (
            <p className="c-det">
              Usually a few seconds. <strong className="font-semibold text-ink">You can close this</strong> — it finishes on
              its own and lands in your activity either way.
            </p>
          ) : progress.status === 'done' ? (
            <>
              <div className="c-conseq">
                <div>
                  <span>From</span>
                  <span>{progress.fromSavings ? 'Savings' : 'Ready to allocate'}</span>
                </div>
                <div className="c-limit">
                  <span>Still owed</span>
                  <span>{progress.stillOwed === 0 ? 'Nothing. Paid off' : money(progress.stillOwed, { cents: true })}</span>
                </div>
              </div>
              <Btn primary lg className="mt-s2" onClick={() => onOpenChange(false)}>
                Done
              </Btn>
            </>
          ) : (
            <div className="c-pair">
              <Btn primary onClick={() => setProgress(null)}>
                Try again
              </Btn>
              <Btn onClick={() => onOpenChange(false)}>Not now</Btn>
            </div>
          )
        }
      >
        <div className="c-mhero">
          {progress.status === 'done' ? <Tick /> : progress.status === 'failed' ? <AlertMark /> : null}
          <p className={cn('c-fig text-fig', progress.status !== 'processing' && 'mt-s2')}>
            {progress.status === 'processing'
              ? `Paying ${money(progress.paid, { cents: true })}`
              : progress.status === 'done'
                ? `${money(progress.paid, { cents: true })} paid`
                : 'Nothing paid'}
          </p>
          <p className="c-sub mt-s1">
            {progress.status === 'processing'
              ? `${progress.fromSavings ? 'Savings' : 'Cash account'} to ${plan.name}`
              : progress.status === 'done'
                ? `${plan.name} · just now`
                : `Your ${money(progress.paid, { cents: true })} is still in your ${from}`}
          </p>
        </div>
        {progress.status !== 'done' && (
          <Steps
            steps={
              progress.status === 'failed'
                ? [{ label: `Not paid, ${progress.failureNote ?? 'it did not go through'}`, state: 'done' as const }]
                : stepsFor(labels, progress.step, progress.status)
            }
          />
        )}
      </Modal>
    );
  }

  const select = (value: number) => {
    setCustom(false);
    setAmount(value);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={plan.name}
      description={`Split in ${plan.splitInto ?? 1}${plan.rate ? ` · ${plan.rate}` : ''}. Paying here goes to this plan only.`}
      footer={
        <>
          <div className="c-conseq">
            <div>
              <span>From</span>
              <span>{fromSavings ? 'Savings' : 'Ready to allocate'}</span>
            </div>
            <div>
              <span>Still owed</span>
              <span>{stillOwed === 0 ? 'Nothing' : money(stillOwed, { cents: true })}</span>
            </div>
            <div className="c-limit">
              <span>Schedule</span>
              <span>
                {stillOwed === 0
                  ? 'Paid off'
                  : behindAfter > 0
                    ? `${money(behindAfter, { cents: true })} behind`
                    : capped >= next && plan.nextDueOn
                      ? `Covered through ${plan.nextDueOn}`
                      : 'On time'}
              </span>
            </div>
          </div>
          {capped > source && (
            <p className="c-det mt-s2 c-errline">
              {fromSavings ? 'That is more than your free savings.' : 'That is more than you have ready to allocate.'}
            </p>
          )}
          {note && <p className={cn('c-det mt-s2', note.bad && 'c-errline')}>{note.text}</p>}
          {plan.splitBlocked && <p className="c-det mt-s2">{plan.splitBlocked}</p>}
          <div className="c-pair mt-s2">
            <Btn disabled={Boolean(plan.splitBlocked)} onClick={onChangeSplit}>
              Change split
            </Btn>
            <Btn primary disabled={capped <= 0 || capped > source || busy || !onPay} onClick={() => void pay()}>
              {busy ? 'Paying…' : `Pay ${money(capped, { cents: true })}`}
            </Btn>
          </div>
        </>
      }
    >
      <p className="c-label">Amount</p>
      <BigAmount amount={capped} onChange={setAmount} editable={custom} />
      <div className="c-qc">
        {next > 0 && next < owed && (
          <Btn className={cn('c-chip-q', !custom && capped === next && 'c-on')} aria-pressed={!custom && capped === next} onClick={() => select(next)}>
            {behind > 0 ? 'Catch up' : 'Next payment'}
          </Btn>
        )}
        <Btn className={cn('c-chip-q', !custom && payoff && 'c-on')} aria-pressed={!custom && payoff} onClick={() => select(owed)}>
          Pay it off
        </Btn>
        <Btn className={cn('c-chip-q', custom && 'c-on')} aria-pressed={custom} onClick={() => setCustom(true)}>
          Custom
        </Btn>
      </div>
      {savingsFree > 0 && (
        <>
          <p className="c-label mt-s3">From</p>
          <div className="c-qc mt-s1!">
            <Btn className={cn('c-chip-q', !fromSavings && 'c-on')} aria-pressed={!fromSavings} onClick={() => setFromSavings(false)}>
              Cash
            </Btn>
            <Btn className={cn('c-chip-q', fromSavings && 'c-on')} aria-pressed={fromSavings} onClick={() => setFromSavings(true)}>
              Savings
            </Btn>
          </div>
        </>
      )}
      {/* The amount first, then where it comes from, as on Repay; where the plan stands follows. */}
      <p className="c-label mt-s3">This plan</p>
      <Rows className="mt-s1">
        <div>
          <Line>
            <span>Owed today</span>
            <span className="c-fig c-fig-row">{money(owed, { cents: true })}</span>
          </Line>
        </div>
        {plan.nextDueOn && (
          <div>
            <Line>
              <span>Next installment</span>
              <span className="c-fig c-fig-row">
                {money(plan.perCycle ?? 0, { cents: true })} <span className="c-muted">· {plan.nextDueOn}</span>
              </span>
            </Line>
          </div>
        )}
        {behind > 0 && (
          <div>
            <Line>
              <span className="c-errline">Behind schedule</span>
              <span className="c-fig c-fig-row c-errline">{money(behind, { cents: true })}</span>
            </Line>
            <p className="c-det mt-[3px]">
              {plan.defaultsOn ? `Catch up by ${plan.defaultsOn} or this plan defaults. ` : ''}
              New plans are paused until you are caught up.
            </p>
          </div>
        )}
      </Rows>
    </Modal>
  );
}
