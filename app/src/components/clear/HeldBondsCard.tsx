import Card from './Card';
import { money } from '@/lib/money';
import { bondElapsed, monthYear, type EarnData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Bonds the member holds — design spec §6.
 *
 * Each bond is a countdown, not a line item: the face value it pays, the month it
 * pays it, and how far along it is. What it's worth today is the number that
 * moves, and it's what the credit line lends against, so it reads beside the
 * time left rather than under the purchase price.
 */
export default function HeldBondsCard({
  data,
  className,
}: {
  data: EarnData;
  className?: string;
}) {
  const { bonds } = data;

  return (
    <Card className={className}>
      <div className="mb-0.5 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">BurnerBonds</span>
        <span className="text-[11px] text-muted-foreground">
          Backs limit at {Math.round(data.bondLtv * 100)}%
        </span>
      </div>

      {bonds.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          No bonds yet — pick a term below to lock in a fixed return.
        </p>
      ) : (
        <div className="text-xs">
          {bonds.map((bond, i) => (
            <div
              key={bond.id}
              className={cn(
                'py-2.5',
                i < bonds.length - 1 && 'border-b-[0.5px] border-border',
              )}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-[13px]">{money(bond.face)} at maturity</span>
                <span className="shrink-0 text-muted-foreground">{monthYear(bond.maturesOn)}</span>
              </div>
              <div className="mb-1.5 h-[5px] overflow-hidden rounded-[3px] bg-border">
                <div
                  className="h-full bg-tier-savings"
                  style={{ width: `${bondElapsed(bond) * 100}%` }}
                />
              </div>
              <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
                <span className="min-w-0 truncate">
                  Paid {money(bond.paid)} · worth{' '}
                  <span className="text-foreground">{money(bond.worthToday)}</span> today
                </span>
                <span className="shrink-0 tabular-nums">{bond.monthsLeft} mo left</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
