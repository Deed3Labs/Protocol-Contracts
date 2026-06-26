import { createContext, useContext, useState, type ReactNode } from 'react';
import ContactsModal from '@/components/app-ui/ContactsModal';

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone?: string;
  /** Optional wallet address. Present → instant transfers + messaging; absent → claim-link sends. */
  wallet?: string;
}

interface ContactsValue {
  contacts: Contact[];
  getContact: (id: string) => Contact | undefined;
  addContact: (c: Omit<Contact, 'id'>) => string;
  updateContact: (id: string, patch: Partial<Omit<Contact, 'id'>>) => void;
  removeContact: (id: string) => void;
  /** Open the contacts manager; pass { add: true } to jump straight to the add form. */
  openManager: (opts?: { add?: boolean }) => void;
}

const Ctx = createContext<ContactsValue | null>(null);

/** Initials for a contact avatar — first letters of up to two name words. */
export const contactInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

/**
 * The user's manually-added contacts (name + email required; phone + wallet optional). Source
 * of truth for the Send recipient picker and reusable for messaging (a contact's wallet is the
 * XMTP peer address). Seeded with mock data; wire to the backend contacts store later.
 */
export function useContacts(): ContactsValue {
  return (
    useContext(Ctx) ?? {
      contacts: [],
      getContact: () => undefined,
      addContact: () => '',
      updateContact: () => {},
      removeContact: () => {},
      openManager: () => {},
    }
  );
}

const SEED: Contact[] = [
  { id: 'c1', name: 'Ahmad Sulaiman', email: 'ahmad@example.com', phone: '+1 415 555 0132', wallet: '0x9F2b1C4a3E5d7F8a0B1c2D3e4F5a6B7c8D9e0F1a' },
  { id: 'c2', name: 'Macellyn Annya', email: 'macellyn@example.com', wallet: '0x3aD17b8E2c5D4f6A1b9C0d8E7f6A5b4C3d2E1f0A' },
  { id: 'c3', name: 'Maria Garcia', email: 'maria.garcia@example.com', phone: '+1 408 555 0190' },
  { id: 'c4', name: 'Devon Lane', email: 'devon.lane@example.com' },
];

export function ContactsProvider({ children }: { children: ReactNode }) {
  const [contacts, setContacts] = useState<Contact[]>(SEED);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerAdd, setManagerAdd] = useState(false);

  const addContact = (c: Omit<Contact, 'id'>) => {
    const id = `c${Date.now()}`;
    setContacts((cs) => [...cs, { ...c, id }].sort((a, b) => a.name.localeCompare(b.name)));
    return id;
  };
  const updateContact = (id: string, patch: Partial<Omit<Contact, 'id'>>) =>
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)).sort((a, b) => a.name.localeCompare(b.name)));
  const removeContact = (id: string) => setContacts((cs) => cs.filter((c) => c.id !== id));

  const value: ContactsValue = {
    contacts,
    getContact: (id) => contacts.find((c) => c.id === id),
    addContact,
    updateContact,
    removeContact,
    openManager: (opts) => {
      setManagerAdd(Boolean(opts?.add));
      setManagerOpen(true);
    },
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <ContactsModal open={managerOpen} onOpenChange={setManagerOpen} startInAdd={managerAdd} />
    </Ctx.Provider>
  );
}
