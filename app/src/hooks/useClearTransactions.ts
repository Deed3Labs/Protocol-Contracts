import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { getTransactionsBatch, getPlaidRecentTransactions, type PlaidRecentTransaction } from '@/utils/apiClient';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
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
  source: string; // lowercased wallet address (primary or a linked wallet), or 'bank'
  /** True when this is a move between the user's OWN accounts (Clear ↔ linked wallet / bank) — not
   *  real income or spending, so it's excluded from those charts and shown as a transfer instead. */
  internal: boolean;
  /** Granular spend bucket for the category donut (Rent, Utilities, Food & Drink, Retail, …). Derived
   *  from Plaid's personal-finance category for bank txs; on-chain sends are 'Misc'. */
  spendCategory: string;
}

export interface CashFlow {
  ts: number; // ms
  usd: number; // signed: + in, - out
}

interface TxValue {
  items: ActivityItem[];
  flows: CashFlow[]; // real income/spending (internal transfers excluded)
  transfers: CashFlow[]; // internal moves between the user's own accounts (for the transfer overlay)
  loading: boolean;
  refresh: () => void;
}

const Ctx = createContext<TxValue | null>(null);

export function useClearTransactions(): TxValue {
  return useContext(Ctx) ?? { items: [], flows: [], transfers: [], loading: false, refresh: () => {} };
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
  from?: string;
  to?: string;
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

/** Map Plaid's personal-finance category (primary + detailed) to a friendly spend bucket for the donut. */
function plaidSpendCategory(primary: string, detailed: string): string {
  const p = primary.toUpperCase();
  const d = detailed.toUpperCase();
  // Plaid has no dedicated "subscription" category — recurring detection is a separate signal — so only
  // an explicit *_SUBSCRIPTION detailed tag counts as Subscriptions. Everything else Plaid files under
  // ENTERTAINMENT (streaming, games, events, music) is its own bucket.
  if (d.includes('SUBSCRIPTION')) return 'Subscriptions';
  if (p.includes('ENTERTAINMENT')) return 'Entertainment';
  if (p.includes('FOOD')) return 'Food & Drink';
  if (p.includes('GENERAL_MERCHANDISE')) return 'Retail';
  if (p.includes('RENT_AND_UTILITIES')) return d.includes('RENT') ? 'Rent' : 'Utilities';
  if (p.includes('TRANSPORTATION') || p.includes('TRAVEL')) return 'Transport';
  if (p.includes('LOAN') || p.includes('BANK_FEES') || p.includes('GOVERNMENT')) return 'Bills';
  if (p.includes('MEDICAL') || p.includes('PERSONAL_CARE')) return 'Health';
  if (p.includes('GENERAL_SERVICES') || p.includes('HOME_IMPROVEMENT')) return 'Services';
  return 'Misc';
}

function toActivity(tx: RawTx, source: string, own: Set<string>): ActivityItem {
  const inbound = /deposit|receiv|incoming|claim/i.test(tx.type || '');
  const usd = typeof tx.amountUsd === 'number' && tx.amountUsd > 0 ? tx.amountUsd : Number(tx.amount) || 0;
  const amount = inbound ? Math.abs(usd) : -Math.abs(usd);
  const status: ActivityStatus = /pending/i.test(tx.status || '')
    ? 'pending'
    : /fail|error|revert/i.test(tx.status || '')
      ? 'failed'
      : 'completed';
  const sym = cleanSymbol(tx.assetSymbol) || 'tokens';
  // The counterparty is the other side of the transfer. If it's one of the user's own wallets, this is
  // an internal move (Clear ↔ linked wallet) — a transfer, not income/spending.
  const counterparty = (inbound ? tx.from : tx.to)?.toLowerCase() || '';
  const internal = counterparty !== '' && own.has(counterparty);
  return {
    id: `${source}:${tx.id}`,
    name: internal ? `Transfer ${sym}` : `${inbound ? 'Received' : 'Sent'} ${sym}`,
    category: inbound && !internal ? 'Deposit' : 'Transfer',
    date: formatDate(tx.date),
    ts: Date.parse(tx.date || '') || 0,
    amount,
    status,
    source,
    internal,
    spendCategory: internal ? 'Transfer' : inbound ? 'Income' : 'Misc',
  };
}

function plaidToActivity(t: PlaidRecentTransaction): ActivityItem {
  const inbound = t.direction === 'inflow';
  const amt = Math.abs(t.amount || 0);
  const cat = (t.category_primary || '').toLowerCase();
  // Plaid TRANSFER_IN/TRANSFER_OUT = money moving between accounts (incl. Clear ↔ this bank) — treat as
  // an internal transfer, not income/spending.
  const internal = /transfer/.test(cat);
  let category: Category = inbound ? 'Deposit' : 'Card';
  if (internal) category = 'Transfer';
  else if (!inbound) {
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
    source: 'bank',
    internal,
    spendCategory: internal ? 'Transfer' : inbound ? 'Income' : plaidSpendCategory(t.category_primary || '', t.category_detailed || ''),
  };
}

export function ClearTransactionsProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAppKitAccount();
  const { externalWallets } = useLinkedWallets();
  // Stable string key of linked addresses so the fetch re-runs when wallets are linked/unlinked.
  const linkedKey = externalWallets.map((w) => w.address.toLowerCase()).sort().join(',');
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [flows, setFlows] = useState<CashFlow[]>([]);
  const [transfers, setTransfers] = useState<CashFlow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isConnected || !address) {
      setItems([]);
      setFlows([]);
      setTransfers([]);
      return;
    }
    setLoading(true);
    try {
      // On-chain activity for the PRIMARY (smart) wallet + every LINKED wallet (one batched request,
      // scoped to ACTIVE_CHAIN_ID so we don't poll Gnosis/Ethereum), plus Plaid bank — merged newest-first
      // and tagged by source so the Transactions filter can narrow to a specific wallet or bank.
      const primaryLower = address.toLowerCase();
      const linked = linkedKey ? linkedKey.split(',').filter((a) => a && a !== primaryLower) : [];
      // The user's own wallets — a transfer whose counterparty is one of these is an internal move.
      const own = new Set([primaryLower, ...linked]);
      const requests = [address, ...linked].map((a) => ({ chainId: ACTIVE_CHAIN_ID, address: a, limit: 15 }));
      const [chainResults, plaid] = await Promise.all([
        getTransactionsBatch(requests).catch(() => []),
        getPlaidRecentTransactions(address).catch(() => null),
      ]);
      const onchain = (chainResults || []).flatMap((r) =>
        ((r.transactions as RawTx[]) || []).map((tx) => toActivity(tx, (r.address || '').toLowerCase(), own)),
      );
      const bank = (plaid?.transactions || []).map(plaidToActivity);
      const merged = [...onchain, ...bank].sort((a, b) => b.ts - a.ts);
      setItems(merged.slice(0, 80));
      // Charts reflect the user's CLEAR cashflow (primary wallet + bank), not linked external wallets.
      // Internal transfers are excluded from income/spending; they feed the separate transfer overlay.
      const clearSide = merged.filter((x) => x.ts > 0 && (x.source === primaryLower || x.source === 'bank'));
      setFlows(clearSide.filter((x) => !x.internal).map((x) => ({ ts: x.ts, usd: x.amount })));
      setTransfers(clearSide.filter((x) => x.internal).map((x) => ({ ts: x.ts, usd: x.amount })));
    } catch {
      setItems([]);
      setFlows([]);
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [address, isConnected, linkedKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh the activity feed (poll + on focus) so new transactions appear without a manual reload.
  useEffect(() => {
    if (!isConnected || !address) return;
    const id = setInterval(() => void load(), 120_000);
    const onFocus = () => void load();
    // Right after a money action (transfer/send/deposit) — refetch now and again shortly, since the
    // on-chain event can lag the indexer by a few seconds.
    const onActivity = () => {
      void load();
      setTimeout(() => void load(), 4000);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('clear:activity', onActivity);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('clear:activity', onActivity);
    };
  }, [load, isConnected, address]);

  return createElement(Ctx.Provider, { value: { items, flows, transfers, loading, refresh: () => void load() } }, children);
}
