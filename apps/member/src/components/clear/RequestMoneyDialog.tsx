import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Modal from './Modal';
import Avatar from './Avatar';
import AmountPicker from './AmountPicker';
import ContactRows from './ContactRows';
import DetailRows from './DetailRows';
import { money } from '@clear/domain';
import { CONTACT_ROLE_LABEL, searchContacts, type Contact } from '@/lib/clearModel';

/**
 * Ask someone for money.
 *
 * Deliberately quieter than sending: the last line says nothing moves until they
 * choose to pay, because a request that looks like a charge is how payment apps
 * get people shouting at each other.
 *
 * Opened without a recipient it starts on the picker — asking "who" before "how
 * much" matches how people actually think about it.
 */
export default function RequestMoneyDialog({
  contact,
  contacts = [],
  open,
  onOpenChange,
  onRequest,
}: {
  /** Preselected recipient; omit to pick one first. */
  contact?: Contact;
  contacts?: Contact[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequest?: (contact: Contact, amount: number, note: string) => void;
}) {
  const [picked, setPicked] = useState<Contact | null>(contact ?? null);
  const [query, setQuery] = useState('');
  const [amount, setAmount] = useState(180);
  const [note, setNote] = useState('');

  const matched = query.trim() ? searchContacts(contacts, query) : contacts;

  if (!picked) {
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Request money"
        description="Choose who to request money from."
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, phone, or @handle"
          aria-label="Search people to request from"
          className="mb-3 h-9 text-xs"
        />
        <ContactRows
          contacts={matched}
          onSelect={setPicked}
          emptyMessage="No one matching — try a phone number or @handle."
        />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Request money"
      description={`Request money from ${picked.name}.`}
      onBack={contact ? undefined : () => setPicked(null)}
    >
      <div className="mb-3.5 flex items-center gap-2.5 border-b-[0.5px] border-border pb-3.5">
        <Avatar id={picked.id} initials={picked.initials} className="h-[34px] w-[34px] text-xs" />
        <div className="min-w-0">
          <p className="truncate text-[13px]">{picked.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {CONTACT_ROLE_LABEL[picked.role]}
          </p>
        </div>
      </div>

      <AmountPicker amount={amount} onChange={setAmount} editable />

      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What's it for?"
        aria-label="What the request is for"
        className="mb-3.5 h-9 text-xs"
      />

      <DetailRows
        className="mb-3.5"
        rows={[
          { label: "They'll get", value: 'A link and a notification' },
          { label: 'Expires', value: 'In 14 days' },
        ]}
      />

      <Button
        size="xs"
        className="w-full"
        disabled={amount <= 0}
        onClick={() => onRequest?.(picked, amount, note)}
      >
        Request {money(amount)}
      </Button>
      <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
        They choose whether to pay. Nothing moves until they do.
      </p>
    </Modal>
  );
}
