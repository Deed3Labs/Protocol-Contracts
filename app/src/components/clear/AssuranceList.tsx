import { ShieldCheck, Shield } from 'lucide-react';
import Card from './Card';
import { count } from '@/lib/money';
import { creditsToGo, isAssuranceActive, type AssuranceItem } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Assurance — design spec §5. Lives inside Savings rather than on its own page,
 * because protections are unlocked by saving.
 *
 * Names come straight from the data. Four of them are still `[PLACEHOLDER —
 * replace]` pending the real product names; they render verbatim on purpose.
 */
export default function AssuranceList({
  items,
  credits,
}: {
  items: AssuranceItem[];
  credits: number;
}) {
  const activeCount = items.filter((i) => isAssuranceActive(i, credits)).length;

  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Assurance</span>
        <span className="text-xs text-muted-foreground">
          {activeCount} of {items.length} active
        </span>
      </div>

      <div className="text-xs">
        {items.map((item, i) => {
          const active = isAssuranceActive(item, credits);
          const Icon = active ? ShieldCheck : Shield;

          return (
            <div
              key={item.id}
              className={cn(
                'flex items-center justify-between gap-3 py-[7px]',
                i < items.length - 1 && 'border-b-[0.5px] border-border',
              )}
            >
              <span
                className={cn(
                  'flex min-w-0 items-center gap-1.5',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <Icon
                  className={cn('h-[15px] w-[15px] shrink-0', active && 'text-tier-asset')}
                  strokeWidth={1.75}
                />
                <span className="truncate">{item.name}</span>
              </span>

              {active ? (
                <span className="shrink-0 text-tier-savings-fg">Active</span>
              ) : (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {count(creditsToGo(item.unlocksAt, credits))} to go
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
