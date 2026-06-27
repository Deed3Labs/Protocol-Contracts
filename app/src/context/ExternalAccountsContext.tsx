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
 * The user's linked external bank accounts (via Plaid → Bridge) — source of truth for the bank
 * pickers in Add money / Withdraw / Pay and managed via ExternalAccountsModal. Seeded with mock
 * data here.
 *
 * SEAM — Bridge's Plaid external-accounts flow (apidocs.bridge.xyz/platform/orchestration/
 * external-accounts/plaid). Requires a Bridge customer first (so registration happens post-KYC;
 * the onboarding "Link bank" step can run Plaid Link earlier and defer registration):
 *   1. POST /v0/customers/{id}/plaid_link_requests → { link_token }
 *   2. open Plaid Link SDK with it → { public_token }
 *   3. POST /v0/plaid_exchange_public_token/{link_token} { public_token }
 *   4. poll GET /v0/customers/{id}/external_accounts (created async) → map into ExternalAccount[]
 * NOTE: Bridge uses Plaid for LINKING ONLY — it does not debit/pull via Plaid. ACH/wire money
 * movement goes through Bridge transfer endpoints with the external account as source/destination.
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
