import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { getTransactionsBatch } from '@/utils/apiClient';
import { SUPPORTED_NETWORKS } from '@/config/networks';
import type { Category } from '@/components/app-ui/TransactionFilterModal';

/**
 * Real on-chain activity for the connected wallet — fed to RecentActivity / the Transactions page.
 * Fetches getTransactionsBatch across the supported chains, maps the backend-normalized tx shape
 * ({ id, type, assetSymbol, amount, amountUsd, date, timestamp, status }) into the UI's Activity
 * shape, sorts newest-first, and strips non-ASCII (spoofed/spam token symbols). One shared fetch
 * via a provider. SEAM: the backend also pushes live updates over WebSocket — could subscribe later.
 */
export type ActivityStatus = 'completed' | 'pending' | 'failed';

export interface ActivityItem {
  id: string;
  name: string;
  category: Category;
  date: string;
  amount: number; // signed: + in, - out
  status: ActivityStatus;
}

interface TxValue {
  items: ActivityItem[];
  loading: boolean;
  refresh: () => void;
}

const Ctx = createContext<TxValue | null>(null);

export function useClearTransactions(): TxValue {
  return useContext(Ctx) ?? { items: [], loading: false, refresh: () => {} };
}

interface RawTx {
  id: string;
  type?: string;
  assetSymbol?: string;
  amount?: number;
  amountUsd?: number | null;
  date?: string;
  timestamp?: number;
  status?: string;
}

const cleanSymbol = (s?: string) => (s || '').replace(/[^\x20-\x7E]/g, '').trim();

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toActivity(tx: RawTx): ActivityItem {
  const inbound = /deposit|receiv|incoming|claim/i.test(tx.type || '');
  const usd = typeof tx.amountUsd === 'number' && tx.amountUsd > 0 ? tx.amountUsd : Number(tx.amount) || 0;
  const amount = inbound ? Math.abs(usd) : -Math.abs(usd);
  const status: ActivityStatus = /pending/i.test(tx.status || '')
    ? 'pending'
    : /fail|error|revert/i.test(tx.status || '')
      ? 'failed'
      : 'completed';
  const sym = cleanSymbol(tx.assetSymbol) || 'tokens';
  return {
    id: tx.id,
    name: `${inbound ? 'Received' : 'Sent'} ${sym}`,
    category: inbound ? 'Deposit' : 'Transfer',
    date: formatDate(tx.date),
    amount,
    status,
  };
}

export function ClearTransactionsProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAppKitAccount();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isConnected || !address) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const requests = SUPPORTED_NETWORKS.map((n) => ({ chainId: n.chainId, address, limit: 15 }));
      const results = await getTransactionsBatch(requests);
      const raw = results.flatMap((r) => (r.transactions as RawTx[]) || []);
      raw.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setItems(raw.slice(0, 30).map(toActivity));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [address, isConnected]);

  useEffect(() => {
    void load();
  }, [load]);

  return createElement(Ctx.Provider, { value: { items, loading, refresh: () => void load() } }, children);
}
