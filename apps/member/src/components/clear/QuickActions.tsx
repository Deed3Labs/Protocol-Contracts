import { Btn } from './brand/anatomy';
import { cn } from '@/lib/utils';

export interface QuickAction {
  label: string;
  onSelect?: () => void;
}

/**
 * The four things you can start from Home — desktop only; on a phone they live in the nav's action
 * button. A 2×2 grid of equal ghost buttons beside the hero, so none of the four reads as the primary
 * one: they are all equally ordinary things to do with money.
 */
export default function QuickActions({ actions, className }: { actions: QuickAction[]; className?: string }) {
  return (
    <div className={cn('c-qa', className)}>
      {actions.map((action) => (
        <Btn key={action.label} onClick={action.onSelect}>
          {action.label}
        </Btn>
      ))}
    </div>
  );
}
