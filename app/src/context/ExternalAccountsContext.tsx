import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getBankBalances, disconnectPlaid } from '@/utils/apiClient';
import { runPlaidLink } from '@/lib/plaidLink';
import ExternalAccountsModal from '@/components/app-ui/ExternalAccountsModal';

export interface ExternalAccount {
  id: string;
  name: string; // institution, e.g. "Chase"
  mask: string; // last 4, e.g. "4821"
  type: string; // "checking" | "savings" | …
  balance?: number;
  itemId?: string; // Plaid item (institution) — disconnect is per-item
}

interface ExternalAccountsValue {
  accounts: ExternalAccount[];
  totalBalance: number;
  linked: boolean;
  loading: boolean;
  linking: boolean;
  /** Launch Plaid Link, then refresh the linked accounts. */
  linkBank: () => Promise<void>;
  /** Disconnect the institution behind this account (Plaid disconnect is per-item). */
  removeAccount: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  openManager: () => void;
}

const Ctx = createContext<ExternalAccountsValue | null>(null);

/**
 * The user's Plaid-linked external bank accounts — source of truth for the bank pickers in Add
 * money / Withdraw / Pay / Transfer, managed via ExternalAccountsModal. Real: backend Plaid routes
 * (getBankBalances / link-token + exchange / disconnect). NOTE: Plaid is linking-only; ACH/wire
 * money movement runs through Bridge transfers with the external account as source/destination.
 */
export function useExternalAccounts(): ExternalAccountsValue {
  return (
    useContext(Ctx) ?? {
      accounts: [],
      totalBalance: 0,
      linked: false,
      loading: false,
      linking: false,
      linkBank: async () => {},
      removeAccount: async () => {},
      refresh: async () => {},
      openManager: () => {},
    }
  );
}

export function ExternalAccountsProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAppKitAccount();
  const [accounts, setAccounts] = useState<ExternalAccount[]>([]);
  const [totalBalance, setTotalBalance] = useState(0);
  const [linked, setLinked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setAccounts([]);
      setTotalBalance(0);
      setLinked(false);
      return;
    }
    setLoading(true);
    try {
      const res = await getBankBalances(address);
      setAccounts(
        (res?.accounts ?? []).map((a) => ({
          id: a.account_id,
          name: a.name,
          mask: a.mask ?? '',
          type: a.subtype || a.type || 'Account',
          balance: a.available ?? a.current ?? 0,
          itemId: a.item_id,
        })),
      );
      setTotalBalance(res?.totalBankBalance ?? 0);
      setLinked(Boolean(res?.linked));
    } catch {
      setAccounts([]);
      setTotalBalance(0);
      setLinked(false);
    } finally {
      setLoading(false);
    }
  }, [address, isConnected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const linkBank = useCallback(async () => {
    if (!address) return;
    setLinking(true);
    try {
      const ok = await runPlaidLink(address);
      if (ok) {
        await new Promise((r) => setTimeout(r, 800)); // let the server persist the item
        await refresh();
      }
    } finally {
      setLinking(false);
    }
  }, [address, refresh]);

  const removeAccount = useCallback(
    async (id: string) => {
      if (!address) return;
      const acct = accounts.find((a) => a.id === id);
      await disconnectPlaid(address, acct?.itemId);
      await refresh();
    },
    [accounts, address, refresh],
  );

  return (
    <Ctx.Provider
      value={{ accounts, totalBalance, linked, loading, linking, linkBank, removeAccount, refresh, openManager: () => setManagerOpen(true) }}
    >
      {children}
      <ExternalAccountsModal open={managerOpen} onOpenChange={setManagerOpen} />
    </Ctx.Provider>
  );
}
