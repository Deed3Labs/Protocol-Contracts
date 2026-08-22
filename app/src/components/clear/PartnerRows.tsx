import { ChevronRight } from 'lucide-react';
import Avatar from './Avatar';
import type { Partner } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Businesses that accept Clear Pay — design spec §7.
 *
 * Deliberately the same row shape as contacts, with a chevron instead of the send
 * arrow: paying a partner is the same gesture as paying a person, but a business
 * has a page behind it and a person doesn't. What it does and where it is are the
 * two things that decide whether you'd go, so they take the sub-line.
 */
export default function PartnerRows({
  partners,
  emptyMessage,
  onSelect,
  className,
}: {
  partners: Partner[];
  emptyMessage: string;
  onSelect?: (partner: Partner) => void;
  className?: string;
}) {
  if (partners.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className={className}>
      {partners.map((partner, i) => (
        <button
          key={partner.id}
          type="button"
          onClick={() => onSelect?.(partner)}
          className={cn(
            'flex w-full items-center gap-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary/60',
            i < partners.length - 1 && 'border-b-[0.5px] border-border',
          )}
        >
          <Avatar id={partner.id} initials={partner.initials} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{partner.name}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {partner.category} · {partner.city}
            </span>
          </span>
          <ChevronRight
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        </button>
      ))}
    </div>
  );
}
