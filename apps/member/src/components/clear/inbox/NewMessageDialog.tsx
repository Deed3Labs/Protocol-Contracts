import { useEffect, useState } from 'react';
import Modal from '../Modal';
import { Line, Rows } from '../brand/anatomy';
import { SearchIcon } from '../brand/icons';
import { RowChevron } from '@/components/settings/SettingsKit';
import { searchContacts, type Contact } from '@/lib/clearModel';

/**
 * New message — support first, then the people you can reach.
 *
 * Support sits above the contacts because it is the one thread a member can start with nobody else
 * involved, and it says how long it usually takes to answer. Partner threads cannot be started here
 * and the footer says so: they begin from a plan or a payment, which is what gives them their
 * context bar. Starting one cold would produce a thread about nothing.
 */
export default function NewMessageDialog({
  contacts,
  open,
  onOpenChange,
  onSupport,
  onContact,
}: {
  contacts: Contact[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSupport: () => void;
  onContact: (contact: Contact) => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const matched = query.trim() ? searchContacts(contacts, query) : contacts;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New message"
      description="Message Clear Support or someone you have paid."
      footer={
        <div className="c-footnote mt-0! border-t-0! pt-0!">
          <p>Merchant threads start from a plan or a payment, not from here. Open the plan and message from it.</p>
        </div>
      }
    >
      <label className="c-searchfield w-full!">
        <span className="c-ic">
          <SearchIcon />
        </span>
        <input
          className="c-field c-bare"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or @handle"
          aria-label="Search people to message"
        />
      </label>
      <Rows className="mt-s2">
        <div>
          <button type="button" onClick={onSupport} className="c-line w-full items-center! text-left">
            <span className="flex items-center gap-[11px]">
              <span aria-hidden className="c-avatarbtn c-sm cursor-default">
                CS
              </span>
              <span>
                <span className="block text-sec">Clear Support</span>
                <span className="c-det mt-[2px] block">Usually answers within an hour</span>
              </span>
            </span>
            <RowChevron />
          </button>
        </div>
        {matched.map((contact) => (
          <div key={contact.id}>
            <button type="button" onClick={() => onContact(contact)} className="c-line w-full items-center! text-left">
              <span className="flex min-w-0 items-center gap-[11px]">
                <span aria-hidden className="c-avatarbtn c-sm cursor-default">
                  {contact.initials}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sec">{contact.name}</span>
                  <span className="c-det mt-[2px] block truncate">{contact.handle ?? contact.contactPoint ?? ''}</span>
                </span>
              </span>
              <RowChevron />
            </button>
          </div>
        ))}
        {matched.length === 0 && (
          <div>
            <Line>
              <span className="c-det">No one matching. Try a name or @handle.</span>
            </Line>
          </div>
        )}
      </Rows>
    </Modal>
  );
}
