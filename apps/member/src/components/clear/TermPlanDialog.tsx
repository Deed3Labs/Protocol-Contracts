import { useEffect, useState } from 'react';
import Modal from './Modal';
import BigAmount from './brand/BigAmount';
import { Btn, Line, Rows } from './brand/anatomy';
import { money } from '@clear/domain';
import type { CashAccount, TermPlan } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

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
  onPay?: (amount: number, payoff: boolean, fromSavings: boolean) => Promise<PayResult>;
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

  // Reopening after the numbers moved should not show last time's amount or result.
  useEffect(() => {
    if (!open) return;
    setAmount(opening);
    setCustom(false);
    setNote(null);
    setFromSavings(false);
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
    const result = await onPay(capped, payoff, fromSavings);
    setBusy(false);
    if (result.repaid && result.repaid > 0) {
      setNote({ text: `Paid ${money(result.repaid, { cents: true })}.${result.error ? ` ${result.error}` : ''}`, bad: false });
    } else {
      setNote({ text: result.error ?? 'That did not go through. Nothing was paid.', bad: true });
    }
  };

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
