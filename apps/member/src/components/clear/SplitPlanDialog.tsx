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
  /** Commit the chosen split. Nothing changes until this runs. */
  onSave?: (splitInto: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const amount = plan.balance ?? 0;
  const [splitInto, setSplitInto] = useState(plan.splitInto ?? 1);

  // Reopening should show what the plan is actually on, not the last thing that was auditioned.
  useEffect(() => {
    if (open) setSplitInto(plan.splitInto ?? 1);
  }, [open, plan.splitInto]);

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
          </div>
          <Btn primary lg className="mt-s2" disabled={splitInto === plan.splitInto} onClick={() => onSave?.(splitInto)}>
            Use this split
          </Btn>
        </>
      }
    >
      <div className="c-balrow">
        <p className="c-nm">Balance at {plan.name}</p>
        <p className="c-fig c-fig-sec">{money(amount, { cents: true })}</p>
      </div>
      <SplitControl amount={amount} options={options} ratePerCycle={ratePerCycle} splitInto={splitInto} onChange={setSplitInto} />
    </Modal>
  );
}
