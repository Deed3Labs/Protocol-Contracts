import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BalanceHeroProps {
  label: string;
  /** Pre-formatted amount string, e.g. "$41,016.67". */
  amount: string;
  /** Optional change copy, e.g. "$421.03 this week". */
  change?: string;
  changePositive?: boolean;
  className?: string;
}

/** Hero balance figure rendered in the condensed display face. One per screen. */
export default function BalanceHero({
  label,
  amount,
  change,
  changePositive = true,
  className,
}: BalanceHeroProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="font-display text-6xl leading-[0.92] tracking-tight text-foreground tabular-nums">
        {amount}
      </span>
      {change && (
        <span
          className={cn(
            'mt-3 inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
            changePositive
              ? 'bg-accent text-accent-foreground'
              : 'bg-destructive/10 text-destructive',
          )}
        >
          {changePositive ? (
            <ArrowUpRight className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5" />
          )}
          {change}
        </span>
      )}
    </div>
  );
}
