import { money } from '@clear/domain';

/**
 * The shop and the amount, carried on every step between the scan and the choice.
 *
 * Its own component rather than a detail of the counter flow because the charge approval screen
 * shows the same pair, and the reference is explicit that these are one pattern rather than two.
 * A member who saw this while signing up should recognise it on every charge afterwards.
 */
export default function PendingTotalHeader({
  merchant,
  amount,
  className = '',
}: {
  merchant: string;
  amount: number;
  className?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 rounded-lg bg-tier-boost/10 px-3 py-2.5 ${className}`}
    >
      <span className="min-w-0 truncate text-xs text-tier-boost-fg">{merchant}</span>
      <span className="shrink-0 text-sm font-medium tabular-nums text-tier-boost-fg">
        {money(amount, { cents: true })}
      </span>
    </div>
  );
}
