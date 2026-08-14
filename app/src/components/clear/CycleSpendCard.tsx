import Card, { CardRule } from './Card';
import { money } from '@/lib/money';
import type { CycleSpend } from '@/lib/clearModel';

/**
 * What this cycle has cost — design spec §8.
 *
 * The split is the reason this card exists: the same $1,842 costs nothing if it
 * came out of cash and carries interest if it came out of credit, so the two are
 * named separately with the carry cost directly under them.
 */
export default function CycleSpendCard({ cycle }: { cycle: CycleSpend }) {
  return (
    <Card>
      {/* Mobile puts the countdown on the label line and folds "spent" into the
          figure; desktop has room to stack them. */}
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-xs text-foreground-secondary">This cycle</span>
        <span className="text-[11px] text-muted-foreground lg:hidden">
          {cycle.daysLeft} days left
        </span>
      </div>
      <p className="font-display text-[26px] font-medium leading-none">
        {money(cycle.spent)}
        <span className="ml-1.5 text-xs font-normal text-muted-foreground lg:hidden">spent</span>
      </p>
      <p className="mb-2.5 mt-1 hidden text-[11px] text-muted-foreground lg:block">
        spent · {cycle.daysLeft} days left
      </p>
      <div className="mb-2.5 lg:hidden" />

      <div className="text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3 leading-[1.9]">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-vest-cash" />
            From cash
          </span>
          <span className="tabular-nums">{money(cycle.fromCash)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 leading-[1.9]">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-tier-asset" />
            From credit
          </span>
          <span className="tabular-nums">{money(cycle.fromCredit)}</span>
        </div>

        {/* Mobile keeps carry cost in the same list — a rule for one row costs
            more height than the separation is worth on a phone. */}
        <div className="flex items-baseline justify-between gap-3 leading-[1.9] lg:hidden">
          <span>Carry cost</span>
          <span className="tabular-nums">{money(cycle.carryCost, { cents: true })}</span>
        </div>
      </div>

      <CardRule className="hidden items-baseline justify-between gap-3 lg:flex">
        <span className="text-xs text-foreground-secondary">Carry cost</span>
        <span className="text-[13px] tabular-nums">{money(cycle.carryCost, { cents: true })}</span>
      </CardRule>
    </Card>
  );
}
