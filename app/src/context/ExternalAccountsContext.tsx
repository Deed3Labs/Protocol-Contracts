import { createContext, useContext, useState, type ReactNode } from 'react';
import ExternalAccountsModal from '@/components/app-ui/ExternalAccountsModal';

export interface ExternalAccount {
  id: string;
  name: string; // institution, e.g. "Chase"
  mask: string; // last 4, e.g. "4821"
  type: string; // "Checking" | "Savings" | …
}

interface ExternalAccountsValue {
  accounts: ExternalAccount[];
  addAccount: (name: string, mask: string, type: string) => string;
  removeAccount: (id: string) => void;
  openManager: () => void;
}

const Ctx = createContext<ExternalAccountsValue | null>(null);

/**
 * The user's linked external bank accounts (via Plaid) — source of truth for the bank pickers in
 * Add money / Withdraw / Pay and managed via ExternalAccountsModal. Seeded with mock data; the
 * real connect/exchange uses Plaid Link (see components/portfolio/DepositModal.tsx +
 * apiClient.getPlaidLinkToken / exchangePlaidToken).
 */
export function useExternalAccounts(): ExternalAccountsValue {
  return (
    useContext(Ctx) ?? {
      accounts: [],
      addAccount: () => '',
      removeAccount: () => {},
      openManager: () => {},
    }
  );
}

const SEED: ExternalAccount[] = [
  { id: 'b1', name: 'Chase', mask: '4821', type: 'Checking' },
  { id: 'b2', name: 'Ally', mask: '7193', type: 'Savings' },
];

export function ExternalAccountsProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<ExternalAccount[]>(SEED);
  const [managerOpen, setManagerOpen] = useState(false);

  const addAccount = (name: string, mask: string, type: string) => {
    const id = `b${Date.now()}`;
    setAccounts((a) => [...a, { id, name, mask, type }]);
    return id;
  };
  const removeAccount = (id: string) => setAccounts((a) => a.filter((x) => x.id !== id));

  return (
    <Ctx.Provider value={{ accounts, addAccount, removeAccount, openManager: () => setManagerOpen(true) }}>
      {children}
      <ExternalAccountsModal open={managerOpen} onOpenChange={setManagerOpen} />
    </Ctx.Provider>
  );
}
