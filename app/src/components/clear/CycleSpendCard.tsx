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
      <p className="mb-1 text-xs text-foreground-secondary">This cycle</p>
      <p className="font-display text-[26px] font-medium leading-none">{money(cycle.spent)}</p>
      <p className="mb-2.5 mt-1 text-[11px] text-muted-foreground">
        spent · {cycle.daysLeft} days left
      </p>

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
      </div>

      <CardRule className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-foreground-secondary">Carry cost</span>
        <span className="text-[13px] tabular-nums">{money(cycle.carryCost, { cents: true })}</span>
      </CardRule>
    </Card>
  );
}
