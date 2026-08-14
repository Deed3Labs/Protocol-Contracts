import { ShieldCheck, Shield, ChevronRight } from 'lucide-react';
import Card from './Card';
import { isAssuranceActive, type AssuranceItem } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Assurance summary on Savings — design spec §5. Lives here because protections
 * are unlocked by saving.
 *
 * Locked rows say "Locked" rather than counting down credits: the countdown lives
 * on the milestone path, and repeating it here made the card read as a second
 * progress tracker instead of a list of what you have.
 *
 * The count in the header is the way through to the detail page, where each
 * protection is actually explained.
 */
export default function AssuranceList({
  items,
  credits,
  onOpen,
}: {
  items: AssuranceItem[];
  credits: number;
  onOpen?: () => void;
}) {
  const activeCount = items.filter((i) => isAssuranceActive(i, credits)).length;

  return (
    <Card className="px-4 py-3.5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Assurance</span>
        <button
          type="button"
          onClick={onOpen}
          className="flex items-center gap-1 text-xs text-tier-boost-fg transition-opacity hover:opacity-80"
        >
          {activeCount} of {items.length}
          <ChevronRight className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </button>
      </div>

      <div className="text-xs">
        {items.map((item, i) => {
          const active = isAssuranceActive(item, credits);
          const Icon = active ? ShieldCheck : Shield;

          return (
            <div
              key={item.id}
              className={cn(
                'flex items-center justify-between gap-2.5 py-2',
                i < items.length - 1 && 'border-b-[0.5px] border-border',
                !active && 'opacity-55',
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Icon
                  className={cn(
                    'h-[15px] w-[15px] shrink-0',
                    active ? 'text-tier-asset' : 'text-muted-foreground',
                  )}
                  strokeWidth={1.75}
                />
                <span className="truncate">{item.name}</span>
              </span>
              <span
                className={cn(
                  'shrink-0 text-[11px]',
                  active ? 'text-tier-savings-fg' : 'text-muted-foreground',
                )}
              >
                {active ? 'Active' : 'Locked'}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
