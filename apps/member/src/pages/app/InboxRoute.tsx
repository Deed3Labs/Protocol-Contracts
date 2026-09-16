import InboxPage from './InboxPage';
import { useContacts } from '@/context/ContactsContext';
import { INBOX } from '@/data/clearPlaceholder';
import { toSendContact } from './SendRoute';

/**
 * Messages, with the member's own contacts behind New message.
 *
 * The threads themselves are still placeholder: conversations live in XMTP (context/XMTPContext),
 * and mapping those to threads — with the payment or plan each one is about — is the adapter this
 * page is waiting on. Alerts are no longer here at all; they are the notifications panel's, and the
 * footer is the way across.
 */
export default function InboxRoute() {
  const { contacts } = useContacts();

  return <InboxPage data={INBOX} contacts={contacts.map(toSendContact)} />;
}
