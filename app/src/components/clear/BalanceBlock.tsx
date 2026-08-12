import { money } from '@/lib/money';
import { availableToSpend, creditLeft, isCreditEngaged, type Credit } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * "Available to spend" headline — design spec §4.
 *
 * Never shows a negative (rule 1) and never includes the ESA (rule 5). The
 * breakdown line names cash first because cash spends first (rule 2); once cash
 * is gone the $0 figure takes the boost color to mark the crossing into credit
 * (rule 6) — a color shift, not a warning.
 */
export default function BalanceBlock({
  cash,
  credit,
  emptyState,
}: {
  cash: number;
  credit: Credit;
  /** Day one: no deposits yet, so there's nothing to break down. */
  emptyState?: boolean;
}) {
  const engaged = isCreditEngaged(cash, credit);

  return (
    <div>
      <p className="mb-1 text-xs text-foreground-secondary">Available to spend</p>
      <p className="font-display mb-1 text-[32px] font-medium leading-none tracking-[-0.5px] lg:text-[38px] lg:tracking-[-0.8px]">
        {money(emptyState ? 0 : availableToSpend(cash, credit))}
      </p>
      {emptyState ? (
        <p className="text-xs text-foreground-secondary">Add money to get started</p>
      ) : (
        <p className="text-xs text-foreground-secondary">
          <span className={cn(engaged && 'font-medium text-tier-boost-fg')}>{money(cash)} cash</span>
          <span className="px-1.5">+</span>
          {money(creditLeft(credit))} credit left
        </p>
      )}
    </div>
  );
}
