import { CircleCheck, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SetupTask } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Day-one body — design spec §4. The setup checklist replaces the cycle, credit
 * and activity cards until there's money in the account.
 *
 * Rows are dividers rather than separate cards, and the next outstanding task is
 * tinted so there's exactly one thing to do.
 */
export default function SetupChecklist({
  tasks,
  onAction,
}: {
  tasks: SetupTask[];
  onAction?: (id: string) => void;
}) {
  const nextId = tasks.find((t) => !t.done)?.id;

  return (
    <div className="overflow-hidden rounded-xl border-[0.5px] border-border">
      {tasks.map((task, i) => {
        const isNext = task.id === nextId;
        return (
          <div
            key={task.id}
            className={cn(
              'flex items-center justify-between gap-3 px-3.5 py-2.5',
              i > 0 && 'border-t-[0.5px] border-border',
              isNext && 'bg-tier-boost/10',
            )}
          >
            <span
              className={cn(
                'flex items-center gap-2 text-xs',
                task.done && 'text-muted-foreground',
                isNext && 'text-tier-boost-fg',
                !task.done && !isNext && 'text-foreground-secondary',
              )}
            >
              {task.done && <CircleCheck className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />}
              {task.label}
            </span>

            {isNext && task.cta ? (
              <Button
                variant="clear"
                size="xs"
                className="border-tier-boost/30"
                onClick={() => onAction?.(task.id)}
              >
                {task.cta}
              </Button>
            ) : (
              !task.done && <ChevronRight className="h-[15px] w-[15px] shrink-0 text-muted-foreground" strokeWidth={1.75} />
            )}
          </div>
        );
      })}
    </div>
  );
}
