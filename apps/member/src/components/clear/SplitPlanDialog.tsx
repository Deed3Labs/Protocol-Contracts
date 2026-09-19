import { useEffect, useState } from 'react';
import Modal from './Modal';
import { SplitConsequences, SplitControl } from './SplitChooser';
import { Btn } from './brand/anatomy';
import { money } from '@clear/domain';
import type { TermPlan } from '@/lib/clearModel';

/**
 * Change your split — opened from a plan on Term plans.
 *
 * The balance and the control are what you touch, so they are main; every figure that follows from
 * the choice is footer, in the same place the move-money summary sits. Picking an option previews it;
 * nothing moves until the button is pressed. A schedule that rewrote itself under the member's finger
 * would be the wrong kind of responsive.
 */
export default function SplitPlanDialog({
  plan,
  options,
  ratePerCycle,
  doneBy,
  onSave,
  open,
  onOpenChange,
}: {
  plan: TermPlan;
  /** The splits on offer, e.g. [1, 2, 4, 12]. */
  options: number[];
  ratePerCycle: number;
  /** When the currently chosen split finishes. */
  doneBy: (splitInto: number) => string;
  /**
   * Commit the chosen split. Nothing changes until this runs. On chain it can fail, so it may
   * return a promise with an error to show; the dialog stays open until it lands.
   */
  onSave?: (splitInto: number) => void | Promise<{ ok?: boolean; error?: string } | void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // A live plan re-splits what it owes now, carry included -- what `setSplit` spreads.
  const amount = plan.owed ?? plan.balance ?? 0;
  const [splitInto, setSplitInto] = useState(plan.splitInto ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening should show what the plan is actually on, not the last thing that was auditioned.
  useEffect(() => {
    if (!open) return;
    setSplitInto(plan.splitInto ?? 1);
    setError(null);
  }, [open, plan.splitInto]);

  const save = async () => {
    if (!onSave) return;
    setBusy(true);
    setError(null);
    const result = await onSave(splitInto);
    setBusy(false);
    if (result && result.error) setError(result.error);
  };

  const rate = `${+(ratePerCycle * 100).toFixed(2)}%`;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Change your split"
      description={`Choose how many cycles your ${plan.name} balance is spread over.`}
      footer={
        <>
          <SplitConsequences amount={amount} ratePerCycle={ratePerCycle} splitInto={splitInto} doneBy={doneBy} />
          <div className="c-footnote">
            <p>{rate} a cycle on what you still owe.</p>
            <p>Clearing early always costs less. You can change this any time.</p>
            {(plan.behind ?? 0) > 0 && <p>What you are behind stays due now; only the rest is re-spread.</p>}
          </div>
          {error && <p className="c-det mt-s2 c-errline">{error}</p>}
          <Btn primary lg className="mt-s2" disabled={splitInto === plan.splitInto || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Use this split'}
          </Btn>
        </>
      }
    >
      <div className="c-balrow">
        <p className="c-nm">{plan.owed !== undefined ? 'Left to pay' : 'Balance'} at {plan.name}</p>
        <p className="c-fig c-fig-sec">{money(amount, { cents: true })}</p>
      </div>
      <SplitControl amount={amount} options={options} ratePerCycle={ratePerCycle} splitInto={splitInto} onChange={setSplitInto} />
    </Modal>
  );
}
