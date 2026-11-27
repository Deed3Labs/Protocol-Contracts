import { Chip, Rows } from './brand/anatomy';
import { ChevronIcon } from './brand/icons';
import type { Partner } from '@/lib/clearModel';

/**
 * Businesses that accept Clear Pay. The same row as a contact — a partner is a contact with a
 * category line and, when it applies, a Credit chip. Two lists, one row.
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
    return <p className="c-det">{emptyMessage}</p>;
  }

  return (
    <Rows className={className}>
      {partners.map((partner) => (
        <button
          key={partner.id}
          type="button"
          onClick={() => onSelect?.(partner)}
          className="c-line w-full items-center! text-left"
        >
          <span className="flex min-w-0 items-center gap-[11px]">
            <span aria-hidden className="c-avatarbtn c-sm cursor-default">
              {partner.initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sec">{partner.name}</span>
              <span className="c-det mt-[2px] block">
                {partner.category} &middot; {partner.city}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center">
            {partner.credit && (
              <span className="mr-s1">
                <Chip tone="neutral">Credit</Chip>
              </span>
            )}
            <ChevronIcon size={14} strokeWidth={2} className="shrink-0 text-ink-50" />
          </span>
        </button>
      ))}
    </Rows>
  );
}
