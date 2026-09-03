import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ContactRows from './ContactRows';
import InfoBlock from './InfoBlock';
import AddContactDialog from './AddContactDialog';
import { searchContacts, type Contact } from '@/lib/clearModel';

/**
 * The address book — design spec §7. Shared by the Contacts page and the settings
 * pane of the same name, so the two can't drift.
 *
 * Members and not-yet-members are separated because the action differs: you can
 * pay a member now, and the honest thing to offer for everyone else is an invite.
 * Sending to them still works — it just becomes a claim link, which the note says
 * out loud rather than leaving to be discovered.
 */
export default function ContactsPanel({
  contacts,
  onSelect,
}: {
  contacts: Contact[];
  onSelect?: (contact: Contact) => void;
}) {
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const matched = query.trim() ? searchContacts(contacts, query) : contacts;
  const members = matched.filter((c) => !c.pending);
  const pending = matched.filter((c) => c.pending);

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search contacts"
          aria-label="Search contacts"
          className="h-9 min-w-0 flex-1 text-xs"
        />
        <Button variant="clear" size="xs" onClick={() => setAddOpen(true)}>
          Add
        </Button>
      </div>

      <p className="mb-1 text-xs text-foreground-secondary">Members</p>
      <ContactRows
        contacts={members}
        onSelect={onSelect}
        emptyMessage={
          query.trim() ? 'No members match that search.' : 'No members saved yet.'
        }
      />

      <p className="mb-1 mt-4 text-xs text-foreground-secondary">Not members yet</p>
      <ContactRows
        contacts={pending}
        onSelect={onSelect}
        onInvite={() => {}}
        emptyMessage={
          query.trim() ? 'Nobody else matches that search.' : 'Everyone you know is in.'
        }
      />

      <InfoBlock tone="neutral" className="mt-4 text-[11px]">
        Sending to someone who isn't a member creates a claim link. They join to collect it.
      </InfoBlock>

      <Button variant="clear" size="xs" className="mt-3.5 w-full">
        Sync phone contacts
      </Button>

      <AddContactDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
