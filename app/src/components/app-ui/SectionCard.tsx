import type { ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tint = 'cash' | 'savings' | 'external' | 'neutral' | 'primary';

const tintClasses: Record<Tint, string> = {
  cash: 'bg-cp-cash text-cp-cash-fg',
  savings: 'bg-cp-savings text-cp-savings-fg',
  external: 'bg-cp-external text-cp-external-fg',
  neutral: 'bg-secondary text-secondary-foreground',
  primary: 'bg-accent text-accent-foreground',
};

interface SectionCardProps {
  icon: LucideIcon;
  tint?: Tint;
  title: string;
  subtitle?: ReactNode;
  /** Pre-formatted amount, rendered in the condensed display face. */
  amount?: string;
  chevron?: boolean;
  onClick?: () => void;
  className?: string;
}

/** Tappable list card: tinted icon tile + title/subtitle + optional amount/chevron. */
export default function SectionCard({
  icon: Icon,
  tint = 'neutral',
  title,
  subtitle,
  amount,
  chevron,
  onClick,
  className,
}: SectionCardProps) {
  const inner = (
    <>
      <span
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
          tintClasses[tint],
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-foreground">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
        )}
      </span>
      {amount && (
        <span className="font-coolvetica text-2xl tracking-tight text-foreground tabular-nums">
          {amount}
        </span>
      )}
      {chevron && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />}
    </>
  );

  const base =
    'flex w-full items-center gap-3 rounded-3xl border border-black/[0.06] bg-card p-4 text-left dark:border-white/[0.06]';

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(base, 'transition-transform active:scale-[0.99]', className)}>
        {inner}
      </button>
    );
  }
  return <div className={cn(base, className)}>{inner}</div>;
}
