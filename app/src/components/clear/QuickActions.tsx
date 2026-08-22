import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface QuickAction {
  label: string;
  onSelect?: () => void;
}

/**
 * The four things you can start from Home — design spec §4.
 *
 * A 2×2 grid rather than a row: it sits beside the balance on desktop and keeps
 * every target the same size, so none of the four reads as the primary one. They
 * are all equally ordinary things to do with money.
 */
export default function QuickActions({
  actions,
  className,
}: {
  actions: QuickAction[];
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      {actions.map((action) => (
        <Button
          key={action.label}
          variant="clear"
          size="sm"
          className="h-9 text-xs"
          onClick={action.onSelect}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
