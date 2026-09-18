import { useEffect, useState } from 'react';
import Modal from './Modal';
import BigAmount from './brand/BigAmount';
import { Btn, Line, Rows } from './brand/anatomy';
import { TIER_TEXT_CLASS } from './ClearCreditCard';
import { money } from '@clear/domain';
import {
  creditUsed,
  cycleShortfall,
  repaidUnsecured,
  repayAllocation,
  securedUsed,
  unsecuredUsed,
  type CashAccount,
  type Credit,
  type Cycle,
} from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** One quick-pick. A pick the source can't fund is offered but disabled, not hidden. */
function Pick({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <Btn className={cn('c-chip-q', selected && 'c-on')} aria-pressed={selected} disabled={disabled} onClick={onSelect}>
      {label}
    </Btn>
  );
}

/**
 * Repay / Move to cash — one component with three states, not three modals.
 *
 * Carrying a balance, the title reads Repay and "This clears" lists what the money reaches, most
 * expensive first. Carrying nothing, it reads Move to cash and that section drops out. Overpaying,
 * the spill line appears — and money only spills once *everything* carried is cleared, not once the
 * cycle is covered: paying past the cycle still buys down the cheap secured tiers, and handing the
 * surplus back while a balance stood would be lending the member their own money.
 *
 * Main is the decision (the amount and its picks); the footer is the consequence and the action.
 */
export default function RepayDialog({
  credit,
  account,
  open,
  onOpenChange,
  onRepay,
}: {
  credit: Credit;
  /** Source is Ready to allocate; destination is the account. Both live here. */
  account: CashAccount;
  /** No longer read: the rebalance warning it dated became the footer's Cycle line. */
  cycle?: Cycle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Repays on chain from the member's USDC. Absent in the preview harness, where the button stays
   * inert. `Move to cash` (nothing carried) is not wired here.
   */
  onRepay?: (amount: number) => Promise<{ repaid?: number; pendingLeft?: number; error?: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const source = account.readyToAllocate;
  const outstanding = creditUsed(credit);
  const carrying = outstanding > 0;
  const toClear = unsecuredUsed(credit);

  // A pick is only offered if the source can fund it, so the opening amount is the largest one that
  // can: clearing the cycle if that's affordable, otherwise everything on hand.
  const clearCycle = Math.min(toClear, source);
  const [amount, setAmount] = useState(carrying ? clearCycle : source);
  const [custom, setCustom] = useState(false);

  // Reopening after the numbers moved should not show the amount from last time.
  useEffect(() => {
    if (!open) return;
    setAmount(carrying ? clearCycle : source);
    setCustom(false);
    setNote(null);
  }, [open, carrying, clearCycle, source]);

  /*
   * Carrying a balance, a repayment is capped at what is owed. The spill line used to promise that
   * anything over would land in Spendable, and nothing moves USDC onto the card -- so the amount
   * simply cannot go past the debt.
   */
  const capped = Math.min(Math.max(0, amount), source, carrying ? outstanding : Infinity);

  const repay = async () => {
    if (!onRepay || capped <= 0) return;
    setBusy(true);
    setNote(null);
    const result = await onRepay(capped);
    setBusy(false);
    if (result.repaid && result.repaid > 0) {
      const pending = result.pendingLeft && result.pendingLeft > 0
        ? ` ${money(result.pendingLeft, { cents: true })} is still pending and can be repaid once it settles.`
        : '';
      setNote({ text: `Repaid ${money(result.repaid, { cents: true })}.${pending}${result.error ? ` ${result.error}` : ''}`, bad: false });
    } else {
      setNote({ text: result.error ?? 'That did not go through. Nothing was repaid.', bad: true });
    }
  };
  const lines = repayAllocation(credit, capped).filter((line) => line.applied > 0);
  const towardCycle = repaidUnsecured(credit, capped);
  // The repayment behaves exactly like more deposit arriving, so the cycle reads it the same way and
  // this surface can't disagree with Home about whether the cycle clears.
  const shortAfter = cycleShortfall(credit, account.nextDepositEstimate + towardCycle);
  const stillCarrying = Math.max(0, outstanding - capped);
  const leftOver = Math.max(0, capped - outstanding);

  const select = (value: number) => {
    setCustom(false);
    setAmount(value);
  };

  const footer = (
    <>
      <div className="c-conseq">
        <div>
          <span>From</span>
          <span>Ready to allocate</span>
        </div>
        {carrying ? (
          <>
            <div>
              <span>Still carrying</span>
              <span>
                {stillCarrying === 0
                  ? 'Nothing'
                  : stillCarrying <= securedUsed(credit)
                    ? `${money(stillCarrying, { cents: true })} secured`
                    : money(stillCarrying, { cents: true })}
              </span>
            </div>
            <div>
              <span>Cycle</span>
              <span>{shortAfter === 0 ? 'Clear' : `${money(shortAfter, { cents: true })} short`}</span>
            </div>
            {leftOver > 0 ? (
              <div className="c-limit">
                <span>Spills into Spendable</span>
                <span>+{money(leftOver, { cents: true })}</span>
              </div>
            ) : (
              <div className="c-limit">
                <span>Most expensive credit clears first</span>
                <span>Always</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <span>Arrives in</span>
              <span>Spendable, instantly</span>
            </div>
            <div>
              <span>Carrying</span>
              <span>Nothing</span>
            </div>
          </>
        )}
      </div>
      {carrying && leftOver > 0 && (
        <div className="c-footnote">
          <p>Money only spills once everything you carry is cleared, not once the cycle is covered.</p>
        </div>
      )}
      {note && <p className={cn('c-det mt-s2', note.bad && 'c-errline')}>{note.text}</p>}
      <Btn
        primary
        lg
        className="mt-s2"
        disabled={capped <= 0 || busy}
        onClick={carrying ? () => void repay() : undefined}
      >
        {busy
          ? 'Repaying…'
          : carrying
            ? `Repay ${money(capped, { cents: true })}`
            : `Move ${money(capped, { cents: true })} to cash`}
      </Btn>
    </>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={carrying ? 'Repay' : 'Move to cash'}
      description={
        carrying
          ? 'Put money against your Clear credit balance, most expensive tier first.'
          : 'Move money from Ready to allocate back to your spendable balance.'
      }
      footer={footer}
    >
      <p className="c-label">Amount</p>
      <BigAmount amount={capped} onChange={setAmount} editable={custom} />
      <div className="c-qc">
        {carrying ? (
          <>
            {toClear > 0 && (
              <Pick
                label="Clear cycle"
                selected={!custom && capped === clearCycle}
                disabled={toClear > source}
                onSelect={() => select(clearCycle)}
              />
            )}
            <Pick
              label="Clear all"
              selected={!custom && capped === outstanding}
              disabled={outstanding > source}
              onSelect={() => select(outstanding)}
            />
          </>
        ) : (
          <Pick label="All" selected={!custom && capped === source} onSelect={() => select(source)} />
        )}
        <Pick label="Custom" selected={custom} onSelect={() => setCustom(true)} />
      </div>

      {carrying && lines.length > 0 && (
        <>
          <p className="c-label mt-s3">This clears</p>
          <Rows className="mt-s1">
            {lines.map((line) => (
              <div key={line.tier.key}>
                <Line>
                  <span className={TIER_TEXT_CLASS[line.tier.key]}>
                    {line.tier.label} &middot; {line.tier.rate.replace(' / cycle', '')}
                  </span>
                  <span className="c-fig c-fig-row">{money(line.applied, { cents: true })}</span>
                </Line>
              </div>
            ))}
          </Rows>
        </>
      )}
    </Modal>
  );
}
