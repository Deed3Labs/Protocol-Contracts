import { Button } from '@/components/ui/button';
import Card from './Card';
import { HeldBondRows } from './HeldBondsCard';
import { money } from '@/lib/money';
import type { BondTerm, HeldBond } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * BurnerBonds — design spec §6.
 *
 * A discrete term ladder rather than the pool's single moving rate: you pick a
 * term, you pay a fixed price today, you get a fixed face value at maturity, and
 * the money is locked until then. The visual language says "choose a row", where
 * the pool's says "watch a number".
 */
export default function BurnerBondsCard({
  terms,
  bonds,
  onBuy,
}: {
  terms: BondTerm[];
  bonds: HeldBond[];
  onBuy?: () => void;
}) {
  return (
    <Card className="flex flex-col">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">BurnerBonds</span>
        <span className="text-[11px] text-muted-foreground">
          <span className="hidden lg:inline">Fixed term · locked to maturity</span>
          <span className="lg:hidden">Locked to maturity</span>
        </span>
      </div>

      <div className="text-xs">
        {terms.map((term, i) => (
          <div
            key={term.months}
            className={cn(
              'flex items-center justify-between gap-2 py-2.5 lg:grid lg:grid-cols-[54px_1fr_54px] lg:items-baseline',
              i < terms.length - 1 && 'border-b-[0.5px] border-border',
            )}
          >
            <span className="min-w-0">
              <span className="block tabular-nums lg:inline">
                {term.months}<span className="lg:hidden"> months</span>
                <span className="hidden lg:inline"> mo</span>
              </span>
              {/* The price pair drops under the term on a phone rather than
                  competing with it for the same line. */}
              <span className="mt-0.5 block text-[11px] text-muted-foreground lg:hidden">
                {money(term.price)} → {money(term.face)}
              </span>
            </span>
            <span className="hidden text-muted-foreground lg:block">
              Pay {money(term.price)} → get {money(term.face)}
            </span>
            <span className="shrink-0 text-right tabular-nums">{term.rate.toFixed(1)}%</span>
          </div>
        ))}
      </div>

      <Button variant="clear" size="xs" className="mt-3 w-full" onClick={onBuy}>
        Buy a bond
      </Button>

      {/* Mobile lifts these into their own card — see HeldBondsCard */}
      <div className="mt-4 hidden border-t-[0.5px] border-border pt-3 lg:block">
        <p className="mb-1.5 text-[13px] text-foreground-secondary">Your bonds</p>
        <HeldBondRows bonds={bonds} />
      </div>

    </Card>
  );
}
