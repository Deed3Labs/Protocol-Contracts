import ContactsPage from './ContactsPage';
import { useSendData } from './SendRoute';

/** Live contacts — the saved address book, and Ready to allocate for sending from it. */
export default function ContactsRoute() {
  const data = useSendData();
  return <ContactsPage contacts={data.contacts} available={data.available} />;
}
