import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Card, { CardRule } from './Card';
import SegmentedBar from './SegmentedBar';
import { money, count } from '@/lib/money';
import { savingsTotal, type Savings } from '@/lib/clearModel';

/**
 * Savings summary on Home — design spec §4.
 *
 * The lock is literal: savings is an ESA and is never summed into "available to
 * spend" (rule 5). Legend reads cash first, then vested and vesting together.
 */
export default function SavingsSummaryCard({
  savings,
  onAdd,
  /** Day one: empty bar plus the pitch line instead of a breakdown. */
  emptyState,
}: {
  savings: Savings;
  onAdd?: () => void;
  emptyState?: boolean;
}) {
  const total = savingsTotal(savings);

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[13px] text-foreground-secondary">
          Savings
          <Lock className="h-[13px] w-[13px] shrink-0" strokeWidth={1.75} />
        </span>
        <span className="text-[17px] font-medium tabular-nums">{money(total)}</span>
      </div>

      <SegmentedBar
        className="my-2.5"
        total={total}
        label="Savings by state"
        segments={[
          { value: savings.cash, className: 'bg-vest-cash', label: 'Cash' },
          { value: savings.vested, className: 'bg-vest-vested', label: 'Vested' },
          { value: savings.vesting, className: 'bg-vest-vesting', label: 'Vesting' },
        ]}
      />

      {emptyState ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Every $1 saved is matched $1 in credits and raises your limit by $1.
        </p>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-3 leading-[1.9]">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-vest-cash" />
                Cash (CLRUSD)
              </span>
              <span className="tabular-nums">{money(savings.cash)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 leading-[1.9]">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-vest-vested" />
                Vested
                <span aria-hidden className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-vest-vesting" />
                Vesting
              </span>
              <span className="tabular-nums">
                {money(savings.vested)} · {money(savings.vesting)}
              </span>
            </div>
          </div>

          <CardRule className="mt-auto flex items-center justify-between gap-3">
            <span className="text-xs">
              {count(savings.credits)} of {count(savings.creditsGoal)} credits
            </span>
            <Button variant="clear" size="xs" onClick={onAdd}>
              Add
            </Button>
          </CardRule>
        </>
      )}
    </Card>
  );
}
