import { ShieldCheck, Shield } from 'lucide-react';
import SettingRows from './SettingRows';
import { assuranceStatus, isAssuranceActive, type AssuranceItem } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * What each protection covers and where it stands — design spec §5.
 *
 * The summary card on Savings answers "how many do I have"; this answers "what
 * are they", so every row carries its description and either the credits it took
 * or the credits still to go. Locked ones stay legible rather than greyed to
 * nothing — they're the reason to keep saving.
 */
export default function AssurancePanel({
  items,
  credits,
  onExplainReserve,
}: {
  items: AssuranceItem[];
  credits: number;
  onExplainReserve?: () => void;
}) {
  return (
    <>
      <p className="mb-3.5 text-xs leading-relaxed text-foreground-secondary">
        Protections that unlock as your credits grow. Backed by the co-op&rsquo;s assurance reserve.
      </p>

      <div>
        {items.map((item, i) => {
          const active = isAssuranceActive(item, credits);
          const Icon = active ? ShieldCheck : Shield;

          return (
            <div
              key={item.id}
              className={cn(
                'flex gap-2.5 py-3',
                i < items.length - 1 && 'border-b-[0.5px] border-border',
              )}
            >
              <Icon
                aria-hidden
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0',
                  active ? 'text-tier-asset' : 'text-muted-foreground',
                )}
                strokeWidth={1.75}
              />
              <div className="min-w-0">
                <p className="text-[13px]">{item.name}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
                <p
                  className={cn(
                    'mt-1 text-[11px]',
                    active ? 'text-tier-savings-fg' : 'text-muted-foreground',
                  )}
                >
                  {assuranceStatus(item, credits)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <SettingRows
        className="mt-2 border-t-[0.5px] border-border pt-1"
        rows={[{ label: 'What the assurance reserve covers', onSelect: onExplainReserve }]}
      />
    </>
  );
}
