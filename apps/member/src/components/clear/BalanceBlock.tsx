import SegmentedBar from './SegmentedBar';
import { money } from '@clear/domain';
import {
  availableToSpend,
  creditLeft,
  creditLimit,
  creditUsed,
  isCreditEngaged,
  type Credit,
} from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * "Available to spend" headline — design spec §4.
 *
 * Never shows a negative (rule 1) and never includes the ESA (rule 5). The
 * breakdown line names cash first because cash spends first (rule 2); once cash
 * is gone the $0 figure takes the boost color to mark the crossing into credit
 * (rule 6) — a color shift, not a warning.
 *
 * The bar underneath is the same three numbers in one shape: cash plus the whole
 * limit is the track, what's been drawn is filled, and the rest is what the
 * headline says is available. It's the shared SegmentedBar, so it sits at the
 * same weight as the ones on Savings and Earn — one bar language across the app.
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
  const used = creditUsed(credit);
  const spendable = Math.max(0, cash) + creditLimit(credit);

  return (
    <div>
      <p className="mb-1 text-xs text-foreground-secondary">Available to spend</p>
      {/* Muted on day one: there's no balance yet, and a full-strength $0.00 reads as a figure that
          means something rather than a space waiting to be filled. */}
      <p
        className={cn(
          'font-display mb-2.5 text-[32px] font-medium leading-none tracking-[-0.5px] lg:text-[40px] lg:tracking-[-0.8px]',
          emptyState && 'text-muted-foreground',
        )}
      >
        {money(emptyState ? 0 : availableToSpend(cash, credit), { cents: true })}
      </p>
      {emptyState ? (
        <p className="text-[11px] text-muted-foreground">Nothing saved yet</p>
      ) : (
        <>
          <SegmentedBar
            className="mb-2"
            total={spendable}
            label={`${money(used)} of ${money(spendable)} spending power used`}
            segments={[{ value: used, className: 'bg-tier-boost', label: 'Used' }]}
          />
          <p className="text-xs text-foreground-secondary">
            <span className={cn(engaged && 'font-medium text-tier-boost-fg')}>{money(cash)} cash</span>
            <span className="px-1.5">·</span>
            {money(used)} used
            <span className="px-1.5">·</span>
            {money(creditLeft(credit))} left
          </p>
        </>
      )}
    </div>
  );
}
