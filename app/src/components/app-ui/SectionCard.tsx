import type { ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SectionRowProps {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  /** Pre-formatted amount, right-aligned. */
  amount?: string;
  chevron?: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * A settings/navigation row. Flat by design: a bare icon, a hairline beneath, and no tinted
 * tile behind the glyph — the icon-in-a-rounded-square inside a card was the densest instance
 * of the card-on-card pattern this redesign removes.
 */
export default function SectionCard({
  icon: Icon,
  title,
  subtitle,
  amount,
  chevron,
  onClick,
  className,
}: SectionRowProps) {
  const inner = (
    <>
      <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
        )}
      </span>
      {amount && (
        <span className="shrink-0 text-sm tabular-nums text-foreground">{amount}</span>
      )}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
    </>
  );

  const base =
    'flex w-full items-center gap-3 border-b border-border py-4 text-left last:border-b-0';

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(base, 'transition-colors hover:bg-foreground/[0.03]', className)}
      >
        {inner}
      </button>
    );
  }
  return <div className={cn(base, className)}>{inner}</div>;
}
