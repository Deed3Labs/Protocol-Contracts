import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import ContactsModal from '@/components/app-ui/ContactsModal';
import {
  getContacts,
  addContactApi,
  updateContactApi,
  deleteContactApi,
  lookupDirectory,
  type ApiContact,
} from '@/utils/apiClient';

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
  /** Directory autofill: resolve a member's wallet from a known email/phone (exact match, opt-out aware). */
  lookupWallet: (q: { email?: string; phone?: string }) => Promise<string | null>;
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

export function useContacts(): ContactsValue {
  return (
    useContext(Ctx) ?? {
      contacts: [],
      getContact: () => undefined,
      addContact: () => '',
      updateContact: () => {},
      removeContact: () => {},
      lookupWallet: async () => null,
      openManager: () => {},
    }
  );
}

const toContact = (c: ApiContact): Contact => ({
  id: c.id,
  name: c.name,
  email: c.email ?? '',
  phone: c.phone ?? undefined,
  wallet: c.wallet ?? undefined,
});
const byName = (a: Contact, b: Contact) => a.name.localeCompare(b.name);

/**
 * The user's contacts (name required; email/phone/wallet optional), stored in the Railway DB and
 * scoped to the connected wallet. Source of truth for the Send recipient picker / messaging. Also
 * exposes a directory lookup so the add form can auto-fill a recipient's wallet from their email or
 * phone when they're a known member. See services/contactsStore.
 */
export function ContactsProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAppKitAccount();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerAdd, setManagerAdd] = useState(false);

  const load = useCallback(async () => {
    if (!isConnected || !address) {
      setContacts([]);
      return;
    }
    const list = await getContacts(address);
    setContacts(list.map(toContact).sort(byName));
  }, [address, isConnected]);

  useEffect(() => {
    void load();
  }, [load]);

  // Optimistic add: show a temp contact immediately, then reconcile it in place with the server's real
  // record (using the POST response — NOT a re-fetch, which can read stale before the write is visible
  // and make the new contact vanish until a refresh). Roll back the temp row if the save fails.
  const addContact = useCallback(
    (c: Omit<Contact, 'id'>) => {
      const tempId = `c${Date.now()}`;
      setContacts((cs) => [...cs, { ...c, id: tempId }].sort(byName));
      if (address) {
        void addContactApi(address, { name: c.name, email: c.email || null, phone: c.phone || null, wallet: c.wallet || null })
          .then((created) => {
            setContacts((cs) =>
              created ? cs.map((x) => (x.id === tempId ? toContact(created) : x)).sort(byName) : cs.filter((x) => x.id !== tempId),
            );
          })
          .catch(() => setContacts((cs) => cs.filter((x) => x.id !== tempId)));
      }
      return tempId;
    },
    [address],
  );

  // Optimistic edit: apply the patch now, reconcile with the server record, reload only on failure.
  const updateContact = useCallback(
    (id: string, patch: Partial<Omit<Contact, 'id'>>) => {
      setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)).sort(byName));
      if (address) {
        void updateContactApi(address, id, { name: patch.name, email: patch.email ?? null, phone: patch.phone ?? null, wallet: patch.wallet ?? null })
          .then((updated) => {
            if (updated) setContacts((cs) => cs.map((c) => (c.id === id ? toContact(updated) : c)).sort(byName));
            else void load();
          })
          .catch(() => void load());
      }
    },
    [address, load],
  );

  // Optimistic remove: drop it now, restore (reload) only if the delete fails.
  const removeContact = useCallback(
    (id: string) => {
      setContacts((cs) => cs.filter((c) => c.id !== id));
      if (address) void deleteContactApi(address, id).then((ok) => { if (!ok) void load(); }).catch(() => void load());
    },
    [address, load],
  );

  const lookupWallet = useCallback(
    async (q: { email?: string; phone?: string }) => {
      if (!address) return null;
      const r = await lookupDirectory(address, q);
      return r.wallet;
    },
    [address],
  );

  const value: ContactsValue = {
    contacts,
    getContact: (id) => contacts.find((c) => c.id === id),
    addContact,
    updateContact,
    removeContact,
    lookupWallet,
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
