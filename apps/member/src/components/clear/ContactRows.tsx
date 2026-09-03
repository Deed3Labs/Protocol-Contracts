import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Avatar from './Avatar';
import { contactHandle, type Contact } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * People you can pay — design spec §7. Initials avatar, name, and the handle or
 * phone number underneath, which is what actually identifies them.
 *
 * Someone who hasn't joined yet gets Invite instead of the send arrow: money sent
 * to them becomes a claim link rather than a transfer, so the honest action is to
 * get them in first.
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
    return <p className="py-3 text-xs text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className={className}>
      {contacts.map((contact, i) => {
        const rule = i < contacts.length - 1 && 'border-b-[0.5px] border-border';

        if (contact.pending && onInvite) {
          return (
            <div
              key={contact.id}
              className={cn('flex items-center justify-between gap-3 py-2 text-[13px]', rule)}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar id={contact.id} initials={contact.initials} />
                <span className="min-w-0">
                  <span className="block truncate">{contact.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {contactHandle(contact)}
                  </span>
                </span>
              </span>
              <Button variant="clear" size="xs" onClick={() => onInvite(contact)}>
                Invite
              </Button>
            </div>
          );
        }

        return (
          <button
            key={contact.id}
            type="button"
            onClick={() => onSelect?.(contact)}
            className={cn(
              'flex w-full items-center gap-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary/60',
              rule,
            )}
          >
            <Avatar id={contact.id} initials={contact.initials} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{contact.name}</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {contactHandle(contact)}
              </span>
            </span>
            <ArrowUpRight
              aria-hidden
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
          </button>
        );
      })}
    </div>
  );
}
