import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Quick-action tile used across pages (Accounts quick actions, Pay's "make a payment").
 * Icon chip + label + hint, with a hover lift, an inverting icon chip, and a corner
 * arrow that nudges. `primary` renders a filled accent tile for the lead action.
 */
export default function ActionTile({
  icon: Icon,
  label,
  hint,
  primary,
  className,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        'group relative flex min-h-[108px] flex-col justify-between gap-4 overflow-hidden rounded-lg border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]',
        primary
          ? 'border-transparent bg-primary text-primary-foreground hover:shadow-[0_12px_30px_-12px_rgba(0,0,0,0.5)]'
          : 'border-border bg-card text-foreground hover:border-foreground/20 hover:shadow-[0_10px_24px_-14px_rgba(0,0,0,0.3)]',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-200',
            primary
              ? 'bg-primary-foreground/15 text-primary-foreground'
              : 'bg-secondary text-foreground group-hover:bg-foreground group-hover:text-background',
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <ArrowUpRight
          className={cn(
            'h-4 w-4 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5',
            primary
              ? 'text-primary-foreground/60 group-hover:text-primary-foreground'
              : 'text-muted-foreground/40 group-hover:text-foreground',
          )}
        />
      </div>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && (
          <div className={cn('mt-0.5 text-xs', primary ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
            {hint}
          </div>
        )}
      </div>
    </button>
  );
}
