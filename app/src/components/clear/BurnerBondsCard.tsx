import { Button } from '@/components/ui/button';
import Card from './Card';
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
        <span className="text-[11px] text-muted-foreground">Fixed term · locked to maturity</span>
      </div>

      <div className="text-xs">
        {terms.map((term, i) => (
          <div
            key={term.months}
            className={cn(
              'grid grid-cols-[54px_1fr_54px] items-baseline gap-2 py-2.5',
              i < terms.length - 1 && 'border-b-[0.5px] border-border',
            )}
          >
            <span className="tabular-nums">{term.months} mo</span>
            <span className="text-muted-foreground">
              Pay {money(term.price)} → get {money(term.face)}
            </span>
            <span className="text-right tabular-nums">{term.rate.toFixed(1)}%</span>
          </div>
        ))}
      </div>

      <Button variant="clear" size="xs" className="mt-3 w-full" onClick={onBuy}>
        Buy a bond
      </Button>

      <p className="mb-1.5 mt-4 border-t-[0.5px] border-border pt-3 text-[13px] text-foreground-secondary">
        Your bonds
      </p>

      {bonds.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No bonds yet — pick a term above to lock in a fixed return.
        </p>
      ) : (
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
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Paid {money(bond.paid)} · matures {bond.maturesOn}
                </p>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {bond.monthsLeft} mo left
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
