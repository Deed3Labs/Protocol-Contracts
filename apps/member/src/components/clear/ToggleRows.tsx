import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface ToggleRow {
  id: string;
  label: string;
  /** The setting's current shape in words — "Over $200", "Every purchase". */
  detail?: string;
  defaultOn?: boolean;
}

/**
 * Rows that carry a switch rather than a chevron — settings you change in place.
 *
 * Kept apart from SettingRows because the two behave differently: a chevron row
 * takes you somewhere, a switch row acts immediately. The detail line under the
 * label is where the setting's scope goes, so the switch itself never has to be
 * labelled twice.
 */
export default function ToggleRows({
  rows,
  className,
}: {
  rows: ToggleRow[];
  className?: string;
}) {
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.defaultOn ?? false])),
  );

  return (
    <div className={cn('text-[13px]', className)}>
      {rows.map((row, i) => (
        <div
          key={row.id}
          className={cn(
            'flex items-center justify-between gap-3.5 py-2.5',
            i < rows.length - 1 && 'border-b-[0.5px] border-border',
          )}
        >
          <span className="min-w-0">
            <label htmlFor={`toggle-${row.id}`} className="block truncate">
              {row.label}
            </label>
            {row.detail && (
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{row.detail}</span>
            )}
          </span>
          <Switch
            id={`toggle-${row.id}`}
            checked={on[row.id]}
            onCheckedChange={(v) => setOn((prev) => ({ ...prev, [row.id]: v }))}
          />
        </div>
      ))}
    </div>
  );
}
