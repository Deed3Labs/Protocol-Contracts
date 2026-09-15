import { money } from '@clear/domain';
import { availableToSpend, creditLeft, creditUsed, type Credit } from '@/lib/clearModel';

/**
 * "Available to spend" — Home's hero, on paper above the blocks.
 *
 * Label, the figure, and one line under it naming cash first because cash spends first. Never a
 * negative, never the ESA. Day one has nothing to break down, so the line says what to do instead.
 */
export default function BalanceBlock({
  cash,
  credit,
  emptyState,
}: {
  cash: number;
  credit: Credit;
  /** Day one: no deposits yet, so there's nothing to break down. */
  emptyState?: boolean;
}) {
  return (
    <div>
      <p className="c-label mb-s1">Available to spend</p>
      <p className="c-fig text-hero-m leading-[1.05] lg:text-hero">
        {money(emptyState ? 0 : availableToSpend(cash, credit), { cents: true })}
      </p>
      <p className="c-sub mt-s1">
        {emptyState
          ? 'Add money to get started'
          : `${money(cash, { cents: true })} cash · ${money(creditUsed(credit), { cents: true })} used · ${money(
              creditLeft(credit),
              { cents: true },
            )} left`}
      </p>
    </div>
  );
}
