import Card from './Card';
import { money } from '@/lib/money';
import type { HeldBond } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Bonds the member already holds — design spec §6.
 *
 * Rows are shared with the tail of BurnerBondsCard, which keeps them inline on
 * desktop where the column is tall enough. On a phone the ladder alone fills the
 * viewport, so the holdings get their own card below it instead of hiding under a
 * scroll inside another one.
 */
export function HeldBondRows({ bonds }: { bonds: HeldBond[] }) {
  if (bonds.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No bonds yet — pick a term above to lock in a fixed return.
      </p>
    );
  }

  return (
    <div className="text-xs">
      {bonds.map((bond, i) => (
        <div
          key={bond.id}
          className={cn(
            'flex items-center justify-between gap-3 py-2.5',
            i < bonds.length - 1 && 'border-b-[0.5px] border-border',
          )}
        >
          <div className="min-w-0">
            <p className="truncate">
              {money(bond.face)} face · {bond.months} mo
            </p>
            {/* Maturity is the only date that matters while the bond is locked;
                what it cost is history and drops off the narrow layout. */}
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              <span className="hidden lg:inline">Paid {money(bond.paid)} · matures </span>
              <span className="lg:hidden">Matures </span>
              {bond.maturesOn}
            </p>
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {bond.monthsLeft} mo<span className="hidden lg:inline"> left</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function HeldBondsCard({
  bonds,
  className,
}: {
  bonds: HeldBond[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <p className="mb-1.5 text-[13px] text-foreground-secondary">Your bonds</p>
      <HeldBondRows bonds={bonds} />
    </Card>
  );
}
