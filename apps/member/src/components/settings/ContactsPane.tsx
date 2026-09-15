import { useState } from 'react';
import { Btn, CFoot, CHead, CMain, Cell, Line, SecHead } from '@/components/clear/brand/anatomy';
import MenuButton from '@/components/clear/brand/MenuButton';
import AddContactDialog from '@/components/clear/AddContactDialog';
import ContactRows from '@/components/clear/ContactRows';
import SendMoneyDialog from '@/components/clear/SendMoneyDialog';
import { CONTACTS } from '@/data/clearPlaceholder';
import type { Contact } from '@/lib/clearModel';

type Filter = 'all' | 'members' | 'pending';
type Sort = 'recent' | 'name';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All contacts' },
  { id: 'members', label: 'Members' },
  { id: 'pending', label: 'Not members yet' },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'name', label: 'Name' },
];

/**
 * Contacts — people you send to and partners you follow. A Settings pane, between Notifications and
 * Linked accounts: people, then institutions. Send's Manage and See all come here rather than to a
 * page of its own.
 *
 * The control bar sits above the slab, the same filter and sort pair as the bonds you own on Earn.
 * A row opens Send; sending to someone who is not a member is the same modal with escrow in its
 * consequences.
 */
export default function ContactsPane({
  contacts = CONTACTS,
  available = 0,
}: {
  contacts?: Contact[];
  available?: number;
}) {
  const [recipient, setRecipient] = useState<Contact | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');

  const filtered = contacts.filter((c) =>
    filter === 'members' ? !c.pending : filter === 'pending' ? c.pending : true,
  );
  // Stored order is most recent first, so Recent is the list as it comes.
  const shown = sort === 'name' ? [...filtered].sort((a, b) => a.name.localeCompare(b.name)) : filtered;

  return (
    <>
      <div className="c-cbarline">
        <div className="c-listctl">
          <MenuButton label={FILTERS.find((f) => f.id === filter)!.label} options={FILTERS} value={filter} onChange={setFilter} />
          <MenuButton
            label={SORTS.find((s) => s.id === sort)!.label}
            options={SORTS}
            value={sort}
            onChange={setSort}
            align="end"
          />
        </div>
      </div>

      <div className="c-slab c-one">
        <Cell>
          <CHead>
            <SecHead label="Contacts">
              <span className="c-det">
                {shown.length} {shown.length === 1 ? 'person' : 'people'}
              </span>
            </SecHead>
          </CHead>
          <CMain>
            <ContactRows
              contacts={shown}
              onSelect={setRecipient}
              emptyMessage={contacts.length === 0 ? 'No one yet.' : 'No one in this view.'}
            />
          </CMain>
          <CFoot>
            <Line className="items-center!">
              <span className="c-det">Added when you first send to someone</span>
              <Btn onClick={() => setAddOpen(true)}>Add by handle</Btn>
            </Line>
          </CFoot>
        </Cell>
      </div>

      <AddContactDialog open={addOpen} onOpenChange={setAddOpen} />

      {recipient && (
        <SendMoneyDialog
          contact={recipient}
          available={available}
          open={recipient !== null}
          onOpenChange={(o) => !o && setRecipient(null)}
        />
      )}
    </>
  );
}
