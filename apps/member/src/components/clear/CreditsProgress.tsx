import Card from './Card';
import { count } from '@clear/domain';
import type { Savings } from '@/lib/clearModel';

/**
 * Progress toward the Clear Deed — the single bar that says how far along the
 * whole point of the product you are.
 *
 * It sits full-width under the balance rather than inside a column, because it
 * measures the goal rather than any one account.
 */
export default function CreditsProgress({ savings }: { savings: Savings }) {
  const pct = savings.creditsGoal > 0 ? (savings.credits / savings.creditsGoal) * 100 : 0;

  return (
    <Card className="px-[17px] py-[15px]">
      <div className="mb-[7px] flex items-baseline justify-between gap-3">
        <span className="text-[13px]">
          {count(savings.credits)}{' '}
          <span className="text-foreground-secondary">of {count(savings.creditsGoal)} credits</span>
        </span>
        <span className="text-xs text-muted-foreground">
          Clear Deed at {count(savings.creditsGoal)}
        </span>
      </div>

      <div
        role="img"
        aria-label={`${count(savings.credits)} of ${count(savings.creditsGoal)} credits`}
        className="h-2 overflow-hidden rounded-[4px] bg-border"
      >
        <div className="h-full bg-tier-savings" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </Card>
  );
}
