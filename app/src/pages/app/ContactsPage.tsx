import { useState } from 'react';
import { Users } from 'lucide-react';
import ContactsPanel from '@/components/clear/ContactsPanel';
import SendMoneyDialog from '@/components/clear/SendMoneyDialog';
import { CONTACTS, HOME_DAY_ONE } from '@/data/clearPlaceholder';
import type { Contact } from '@/lib/clearModel';

/**
 * Contacts — design spec §7.
 *
 * A page of its own, reached from Send, and the same panel appears as a settings
 * section: people manage their address book from either place depending on what
 * they came to do, and both are the same list.
 */
export default function ContactsPage({ contacts = CONTACTS }: { contacts?: Contact[] }) {
  const [recipient, setRecipient] = useState<Contact | null>(null);

  return (
    <>
      <div className="mb-4 hidden items-center gap-2.5 lg:flex">
        <Users
          aria-hidden
          className="h-[18px] w-[18px] shrink-0 text-foreground-secondary"
          strokeWidth={1.75}
        />
        <h1 className="text-[17px] font-medium lg:text-xl">Contacts</h1>
      </div>

      {/* Narrow on desktop: it's a list of names, and a full-width one would run
          the actions a screen away from the person they belong to. */}
      <div className="lg:max-w-[560px]">
        <ContactsPanel contacts={contacts} onSelect={setRecipient} />
      </div>

      {recipient && (
        <SendMoneyDialog
          contact={recipient}
          credit={HOME_DAY_ONE.credit}
          cash={HOME_DAY_ONE.cash}
          open={recipient !== null}
          onOpenChange={(o) => !o && setRecipient(null)}
        />
      )}
    </>
  );
}
