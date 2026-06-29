import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { getTransactionsBatch, getPlaidRecentTransactions, type PlaidRecentTransaction } from '@/utils/apiClient';
import { SUPPORTED_NETWORKS, DATA_CHAIN_IDS } from '@/config/networks';
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
  ts: number; // ms epoch, for range filtering/grouping
  amount: number; // signed: + in, - out
  status: ActivityStatus;
}

export interface CashFlow {
  ts: number; // ms
  usd: number; // signed: + in, - out
}

interface TxValue {
  items: ActivityItem[];
  flows: CashFlow[];
  loading: boolean;
  refresh: () => void;
}

const Ctx = createContext<TxValue | null>(null);

export function useClearTransactions(): TxValue {
  return useContext(Ctx) ?? { items: [], flows: [], loading: false, refresh: () => {} };
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
    ts: Date.parse(tx.date || '') || 0,
    amount,
    status,
  };
}

function plaidToActivity(t: PlaidRecentTransaction): ActivityItem {
  const inbound = t.direction === 'inflow';
  const amt = Math.abs(t.amount || 0);
  const cat = (t.category_primary || '').toLowerCase();
  let category: Category = inbound ? 'Deposit' : 'Card';
  if (!inbound) {
    if (/rent|util|bill|loan|mortgage|insurance/.test(cat)) category = 'Bill';
    else if (/subscription|recurring/.test(cat)) category = 'Subscription';
    else if (/income|payroll|deposit/.test(cat)) category = 'Payroll';
  }
  return {
    id: t.transaction_id,
    name: t.merchant_name || t.name || 'Bank transaction',
    category,
    date: formatDate(t.date),
    ts: Date.parse(t.date || '') || 0,
    amount: inbound ? amt : -amt,
    status: t.pending ? 'pending' : 'completed',
  };
}

export function ClearTransactionsProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAppKitAccount();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [flows, setFlows] = useState<CashFlow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isConnected || !address) {
      setItems([]);
      setFlows([]);
      return;
    }
    setLoading(true);
    try {
      // On-chain (linked wallet) + Plaid (external accounts), merged + newest-first.
      // Only the actively-tracked chains (drops empty chains → fewer Alchemy getAssetTransfers calls).
      const requests = SUPPORTED_NETWORKS
        .filter((n) => DATA_CHAIN_IDS.includes(n.chainId))
        .map((n) => ({ chainId: n.chainId, address, limit: 15 }));
      const [chainResults, plaid] = await Promise.all([
        getTransactionsBatch(requests).catch(() => []),
        getPlaidRecentTransactions(address).catch(() => null),
      ]);
      const onchain = (chainResults || [])
        .flatMap((r) => (r.transactions as RawTx[]) || [])
        .map(toActivity);
      const bank = (plaid?.transactions || []).map(plaidToActivity);
      const merged = [...onchain, ...bank].sort((a, b) => b.ts - a.ts);
      setItems(merged.slice(0, 50));
      setFlows(merged.filter((x) => x.ts > 0).map((x) => ({ ts: x.ts, usd: x.amount })));
    } catch {
      setItems([]);
      setFlows([]);
    } finally {
      setLoading(false);
    }
  }, [address, isConnected]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh the activity feed (poll + on focus) so new transactions appear without a manual reload.
  useEffect(() => {
    if (!isConnected || !address) return;
    const id = setInterval(() => void load(), 45_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [load, isConnected, address]);

  return createElement(Ctx.Provider, { value: { items, flows, loading, refresh: () => void load() } }, children);
}
