import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import { money } from '@/lib/money';
import { splitQuote, type TermPlan } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Choosing the split — design spec §4c.
 *
 * Offered at checkout and changeable any time after, which is why it's one surface rather than a
 * checkout step: a member who took four cycles and then came into money should be able to collapse
 * it from the same place they set it.
 *
 * The three figures beneath the control are what make the choice honest. Spreading further costs
 * more, and the carry line says so in dollars as the member moves between options — no warning
 * needed, and none given. Carry accrues by time held with no fixed due date, so clearing early
 * always costs less; the footer says that outright because it's the rule the whole product turns on
 * and it isn't visible from any single option.
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
  /** When the currently chosen split finishes, e.g. "Mar 14". */
  doneBy: (splitInto: number) => string;
  /** Commit the chosen split. Nothing changes until this runs — see the Save button below. */
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

  const quote = splitQuote(amount, splitInto, ratePerCycle);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={plan.name}
      description="Choose how many cycles this plan is spread over."
    >
      <p className="font-display mb-3.5 text-2xl font-medium tabular-nums">
        {money(amount, { cents: true })}
      </p>

      <p className="mb-2 text-[11px] tracking-[0.2px] text-muted-foreground">HOW TO CLEAR IT</p>
      <div className="mb-3 flex gap-1.5">
        {options.map((option) => (
          <Button
            key={option}
            variant="clear"
            size="xs"
            aria-pressed={splitInto === option}
            onClick={() => setSplitInto(option)}
            className={cn('flex-1', splitInto === option && 'border-tier-boost text-tier-boost-fg')}
          >
            {option === 1 ? 'In full' : `In ${option}`}
          </Button>
        ))}
      </div>

      <div className="border-t-[0.5px] border-border pt-2.5 text-xs leading-[2.1]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-foreground-secondary">Each cycle</span>
          <span className="tabular-nums">{money(quote.perCycle, { cents: true })}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-foreground-secondary">Carry, total</span>
          <span className="tabular-nums">
            {money(quote.carry, { cents: true })}
            {plan.rate && <span className="text-muted-foreground"> · {plan.rate}</span>}
          </span>
        </div>
        {/* The carry above is the cost on its own; this is what the plan comes to altogether. Both
            belong here — one answers what the credit costs, the other what actually gets paid. */}
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-foreground-secondary">Total</span>
          <span className="tabular-nums">{money(quote.total, { cents: true })}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-foreground-secondary">Done by</span>
          <span>{doneBy(splitInto)}</span>
        </div>
      </div>

      {/* Picking an option previews it; nothing moves until this is pressed. A schedule that
          rewrote itself under the member's finger would be the wrong kind of responsive. */}
      <Button
        size="sm"
        className="mt-3.5 w-full"
        disabled={splitInto === plan.splitInto}
        onClick={() => onSave?.(splitInto)}
      >
        {splitInto === plan.splitInto ? 'No changes' : 'Save changes'}
      </Button>

      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Clearing early always costs less. You can change this any time.
      </p>
    </Modal>
  );
}
