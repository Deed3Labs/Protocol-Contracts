import { Btn, Line, Rows } from './brand/anatomy';
import { ChevronIcon } from './brand/icons';
import { contactHandle, type Contact } from '@/lib/clearModel';

/**
 * People you can pay — one row component for contacts and, with a category line and a chip, for
 * partners (see PartnerRows).
 *
 * A square avatar with initials (an avatar is an image, and images are square), the name, and the
 * handle or phone number underneath, which is what actually identifies them; a chevron, because
 * the row opens something.
 *
 * `onInvite` is for surfaces that separate not-yet-members: they get Invite instead of the chevron.
 * The Send page does not pass it, because sending to a non-member is the same modal with different
 * consequences.
 */
export default function ContactRows({
  contacts,
  emptyMessage,
  onSelect,
  onInvite,
  className,
}: {
  contacts: Contact[];
  emptyMessage: string;
  onSelect?: (contact: Contact) => void;
  onInvite?: (contact: Contact) => void;
  className?: string;
}) {
  if (contacts.length === 0) {
    return <p className="c-det">{emptyMessage}</p>;
  }

  return (
    <Rows className={className}>
      {contacts.map((contact) => {
        const person = (
          <span className="flex min-w-0 items-center gap-[11px]">
            <span aria-hidden className="c-avatarbtn c-sm cursor-default">
              {contact.initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sec">{contact.name}</span>
              <span className="c-det mt-[2px] block">{contactHandle(contact)}</span>
            </span>
          </span>
        );

        if (contact.pending && onInvite) {
          return (
            <div key={contact.id}>
              <Line className="items-center!">
                {person}
                <Btn onClick={() => onInvite(contact)}>Invite</Btn>
              </Line>
            </div>
          );
        }

        return (
          <button
            key={contact.id}
            type="button"
            onClick={() => onSelect?.(contact)}
            className="c-line w-full items-center! text-left"
          >
            {person}
            <ChevronIcon size={14} strokeWidth={2} className="shrink-0 text-ink-50" />
          </button>
        );
      })}
    </Rows>
  );
}
