import { Button } from '@/components/ui/button';
import Card from './Card';
import { money } from '@/lib/money';
import type { BondTerm } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * The bond ladder — design spec §6.
 *
 * Four fixed terms, longest paying most. The bar on each row is the rate against
 * the best rate on offer, so the ladder reads as a slope rather than four numbers
 * you have to compare in your head; the price pair underneath is the same fact in
 * dollars.
 */
export default function BondLadder({
  terms,
  onBuy,
  /** Mobile carries the action inside this card; desktop puts it in the note beside it. */
  showBuy = false,
  className,
}: {
  terms: BondTerm[];
  onBuy?: () => void;
  showBuy?: boolean;
  className?: string;
}) {
  const best = terms.reduce((max, t) => Math.max(max, t.rate), 0);

  return (
    <Card className={className}>
      {terms.map((term, i) => (
        <div
          key={term.months}
          className={cn(
            'grid grid-cols-[52px_1fr_46px] items-center gap-2.5 py-2.5',
            i < terms.length - 1 && 'border-b-[0.5px] border-border',
          )}
        >
          <span className="text-xs tabular-nums">{term.months} mo</span>
          <div>
            <div className="mb-1 h-1.5 overflow-hidden rounded-[3px] bg-border">
              <div
                className="h-full bg-tier-savings"
                style={{ width: `${best > 0 ? (term.rate / best) * 100 : 0}%` }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">
              Pay {money(term.price)} → get {money(term.face)}
            </span>
          </div>
          <span className="text-right text-[13px] tabular-nums">{term.rate.toFixed(1)}%</span>
        </div>
      ))}

      {showBuy && (
        <Button size="sm" className="mt-3 w-full text-xs" onClick={onBuy}>
          Buy a bond
        </Button>
      )}
    </Card>
  );
}
