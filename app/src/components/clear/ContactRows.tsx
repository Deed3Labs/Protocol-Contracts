import { CONTACT_ROLE_LABEL, type Contact } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Avatar tints vary per person, not per role — the reference gives two members
 * different colors, so the tint is identity, not meaning. The role is carried by
 * the label underneath. Picked deterministically from the id so a contact keeps
 * the same color every time it's rendered.
 */
const AVATAR_TINTS = [
  'bg-tier-boost/10 text-tier-boost-fg',
  'bg-tier-savings/10 text-tier-savings-fg',
  'bg-secondary text-foreground-secondary',
];

function tintFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

/**
 * Recent recipients — design spec §7. Initials avatar, name, and the role label
 * that distinguishes a member from a Clear Partner (a business you can pay).
 */
export default function ContactRows({
  contacts,
  emptyMessage,
  onSelect,
}: {
  contacts: Contact[];
  emptyMessage: string;
  onSelect?: (contact: Contact) => void;
}) {
  if (contacts.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div>
      {contacts.map((contact, i) => (
        <button
          key={contact.id}
          type="button"
          onClick={() => onSelect?.(contact)}
          className={cn(
            'flex w-full items-center gap-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary/60',
            i < contacts.length - 1 && 'border-b-[0.5px] border-border',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px]',
              tintFor(contact.id),
            )}
          >
            {contact.initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate">{contact.name}</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {CONTACT_ROLE_LABEL[contact.role]}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
