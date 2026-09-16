import { money } from '@clear/domain';
import { cn } from '@/lib/utils';

/**
 * The shop and the amount, carried on every step between the scan and the choice.
 *
 * It sits above the panel rather than inside it, because it belongs to the visit and not to the
 * step — it is the strongest motivation in the product, and what makes five steps tolerable while
 * somebody waits at a till.
 *
 * Its own component rather than a detail of the counter flow because the charge approval screen
 * shows the same pair, and the reference is explicit that these are one pattern rather than two.
 */
export default function PendingTotalHeader({
  merchant,
  amount,
  className,
}: {
  merchant: string;
  amount: number;
  className?: string;
}) {
  return (
    <div className={cn('c-pending', className)}>
      <span className="min-w-0 truncate">{merchant}</span>
      <span className="c-fig c-fig-row shrink-0">{money(amount, { cents: true })}</span>
    </div>
  );
}
