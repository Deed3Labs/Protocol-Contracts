import { cn } from '@/lib/utils';

export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
  /** Shown after the label in the accent colour — unread, pending, whatever's waiting. */
  count?: number;
}

/**
 * A two- or three-way switch between views of the same surface — design spec §1.
 *
 * A recessed track with the selected segment raised out of it, which is the one
 * control shape people already read as "these are alternatives, not actions".
 * Used by the Inbox and the theme picker.
 */
export default function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: SegmentedTab<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-[3px] rounded-[11px] bg-secondary p-[3px]', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-[7px] text-xs transition-colors',
            value === tab.id
              ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]'
              : 'text-foreground-secondary hover:text-foreground',
          )}
        >
          {tab.label}
          {tab.count ? <span className="text-tier-boost-fg">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
