import Card from './Card';
import { money } from '@/lib/money';
import { monthYear, type EarnData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Bonds the member holds — design spec §6.
 *
 * Face value is the hero: it's the promise, and it's the number the member bought. Every line is a
 * left value and a right value on one axis — centred blocks inside a two-column card were the flaw
 * in the first version, because nothing lined up with anything.
 *
 * Worth today sits below a rule of its own. It's the one figure here that moves, and it carries the
 * accretion story that makes the credit limit grow without the member doing anything, so it reads as
 * a conclusion rather than another attribute. Term and countdown stay tertiary, and the face value
 * is printed once.
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
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
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
        bonds.map((bond, i) => (
          <div
            key={bond.id}
            className={cn(
              i < bonds.length - 1 && 'mb-3.5 border-b-[0.5px] border-border pb-3.5',
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] font-medium tabular-nums lg:text-base">
                {money(bond.face, { cents: true })}
              </span>
              <span className="shrink-0 text-[11px] text-foreground-secondary lg:text-xs">
                {monthYear(bond.maturesOn)}
              </span>
            </div>

            <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground lg:text-xs">
              <span className="min-w-0 truncate">
                at maturity · paid {money(bond.paid, { cents: true })}
              </span>
              <span className="shrink-0 tabular-nums">
                {bond.monthsLeft} <span className="lg:hidden">mo</span>
                <span className="hidden lg:inline">months</span> left
              </span>
            </div>

            <div className="mt-2 flex items-baseline justify-between gap-3 border-t-[0.5px] border-border pt-2">
              <span className="text-[11px] text-foreground-secondary lg:text-xs">Worth today</span>
              <span className="text-[13px] font-medium tabular-nums lg:text-sm">
                {money(bond.worthToday, { cents: true })}
              </span>
            </div>
          </div>
        ))
      )}
    </Card>
  );
}
