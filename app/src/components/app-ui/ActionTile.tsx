import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Quick-action tile (Pay's "make a payment"). A control, so it keeps a border — but the icon is
 * bare rather than sitting in a tinted square, and there's no hover lift, so it reads as a
 * pressable region of the page rather than a floating card. `primary` fills the lead action.
 */
export default function ActionTile({
  icon: Icon,
  label,
  hint,
  primary,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  primary?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex min-h-[104px] flex-col justify-between gap-4 overflow-hidden border p-4 text-left transition-colors duration-150',
        primary
          ? 'border-transparent bg-primary text-primary-foreground hover:opacity-90'
          : 'border-border text-foreground hover:border-foreground/30 hover:bg-foreground/[0.03]',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <Icon
          className={cn(
            'h-5 w-5',
            primary ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground',
          )}
          strokeWidth={1.5}
        />
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
