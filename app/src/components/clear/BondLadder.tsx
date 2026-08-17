import { Button } from '@/components/ui/button';
import Card from './Card';
import { money } from '@/lib/money';
import type { BondTerm } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** The four columns, in one place so the header and the rows can't drift out of alignment. */
const COLS = 'grid grid-cols-[52px_1fr_1fr_46px] gap-2 lg:grid-cols-[78px_1fr_1fr_54px] lg:gap-3';

/**
 * The bond ladder — design spec §6.
 *
 * A table, not a chart. Four terms is too few to read as a curve — plotted, it looks like a line
 * with dots on it, and the member still has to read the numbers off the axis. Here the discount is
 * visible by subtraction, on the row.
 *
 * Every row states its own face value rather than leaning on a "per $1,000" caption above the
 * table. It costs a column and removes a thing to remember: what you pay and what you get sit side
 * by side, and the yield is the same fact expressed as a rate.
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
  return (
    <Card className={cn('px-[14px] pb-3 pt-1 lg:px-[17px] lg:pb-[15px]', className)}>
      <div
        className={cn(
          COLS,
          'border-b-[0.5px] border-border pb-2 pt-2.5 text-[10px] text-muted-foreground lg:text-[11px]',
        )}
      >
        <span>Term</span>
        <span className="text-right">
          <span className="lg:hidden">Pay</span>
          <span className="hidden lg:inline">You pay</span>
        </span>
        <span className="text-right">
          <span className="lg:hidden">Get</span>
          <span className="hidden lg:inline">You get</span>
        </span>
        <span className="text-right">Yield</span>
      </div>

      {terms.map((term, i) => (
        <div
          key={term.months}
          className={cn(
            COLS,
            'items-center py-2.5 text-xs tabular-nums lg:text-[13px]',
            i < terms.length - 1 && 'border-b-[0.5px] border-border',
          )}
        >
          <span>
            {term.months} <span className="lg:hidden">mo</span>
            <span className="hidden lg:inline">months</span>
          </span>
          <span className="text-right text-muted-foreground">{money(term.price, { cents: true })}</span>
          <span className="text-right">{money(term.face, { cents: true })}</span>
          <span className="text-right font-medium">{term.rate.toFixed(1)}%</span>
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
