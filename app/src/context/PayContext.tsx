import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Home, Zap, Repeat, CreditCard, Smartphone, Receipt, type LucideIcon } from 'lucide-react';
import { useAppKitAccount } from '@reown/appkit/react';
import PayModal from '@/components/app-ui/PayModal';
import { useKyc } from '@/context/KycContext';
import {
  getPlaidRecurringTransactions,
  getPayBillers,
  getPaySummary,
  addPayBiller,
  updatePayBiller,
  deletePayBiller,
  setPayBillerPayout,
  payBiller,
  syncPlaidBillers,
  recordPayment,
  reconcilePay,
  type PayBiller,
  type PaySummary,
} from '@/utils/apiClient';

export type BillType = 'rent' | 'utility' | 'subscription' | 'card' | 'phone' | 'other';

/** Selectable biller types with their icons — drives the Add-biller type picker. */
export const BILL_TYPES: { value: BillType; label: string; icon: LucideIcon }[] = [
  { value: 'rent', label: 'Rent', icon: Home },
  { value: 'utility', label: 'Utilities', icon: Zap },
  { value: 'subscription', label: 'Subscription', icon: Repeat },
  { value: 'card', label: 'Credit card', icon: CreditCard },
  { value: 'phone', label: 'Phone', icon: Smartphone },
  { value: 'other', label: 'Other', icon: Receipt },
];

export interface Bill {
  id: string;
  name: string; // "Electric — ConEd"
  payee: string; // "ConEd"
  type: BillType;
  amount: number;
  dueLabel: string; // "Jun 28"
  dueDay: number | null; // 1-31, for due-date math
  icon: LucideIcon;
  source: 'manual' | 'plaid'; // only manual billers are editable; plaid = auto-detected, read-only
  payable: boolean; // has ACH payout details on file → can be paid in-app
  payoutLast4: string | null;
  payoutBank: string | null;
}

/** Fields a user can set/edit on a biller (id/icon derived; source + payout are server-controlled). */
export type BillerDraft = Omit<Bill, 'id' | 'icon' | 'source' | 'payable' | 'payoutLast4' | 'payoutBank'>;

/** On-time streak fallback when no summary is loaded yet. */
export const ON_TIME_STREAK = 0;

/** Streak multiplier: +5% per on-time month, capped at 12 months (1.0×–1.6×). */
export const streakMultiplier = (streak = ON_TIME_STREAK) => 1 + Math.min(Math.max(streak, 0), 12) * 0.05;

/**
 * Clear Pay equity credits for paying a bill ON TIME (preview of what the backend awards). Flat base
 * by type (rent rewards most) × the on-time streak multiplier, rounded to 5. NON-redeemable — credits
 * only count toward the Clear Deed milestone. Never interest/APY.
 */
export const creditsFor = (bill: Pick<Bill, 'type'>, streak = ON_TIME_STREAK) => {
  const base = bill.type === 'rent' ? 300 : 50;
  return Math.round((base * streakMultiplier(streak)) / 5) * 5;
};

const ICONS: Record<BillType, LucideIcon> = { rent: Home, utility: Zap, subscription: Repeat, card: CreditCard, phone: Smartphone, other: Receipt };

function inferType(name: string): BillType {
  const s = name.toLowerCase();
  if (/rent|apartment|property|lease|landlord|housing/.test(s)) return 'rent';
  if (/electric|gas|water|utility|energy|internet|wifi|broadband|coned|pg&e/.test(s)) return 'utility';
  if (/netflix|spotify|hulu|disney|prime|youtube|subscription|membership|apple\.com\/bill|patreon/.test(s)) return 'subscription';
  if (/\bcard\b|amex|visa|mastercard|discover|credit/.test(s)) return 'card';
  if (/phone|mobile|wireless|verizon|t-mobile|at&t|sprint/.test(s)) return 'phone';
  return 'other';
}

function dueLabelFromDay(day: number | null): string {
  if (!day) return '';
  const now = new Date();
  let d = new Date(now.getFullYear(), now.getMonth(), day);
  if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dueDateISO(day: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), day).toISOString().slice(0, 10);
}

function billerToBill(b: PayBiller): Bill {
  return {
    id: b.id,
    name: b.name,
    payee: b.payee ?? '',
    type: b.type,
    amount: b.defaultAmount,
    dueLabel: dueLabelFromDay(b.dueDay),
    dueDay: b.dueDay,
    icon: ICONS[b.type] ?? Receipt,
    source: b.source,
    payable: b.payable,
    payoutLast4: b.payoutLast4,
    payoutBank: b.payoutBank,
  };
}

interface PayValue {
  bills: Bill[];
  summary: PaySummary | null;
  loading: boolean;
  getBill: (id: string) => Bill | undefined;
  addBiller: (b: BillerDraft) => string;
  /** Edit a MANUALLY-added biller (no-op on auto-detected ones; optimistic, persists in background). */
  updateBiller: (id: string, b: BillerDraft) => void;
  /** Remove a biller (optimistic; persists the delete in the background). */
  removeBiller: (id: string) => void;
  /** Save a biller's ACH payout destination (account/routing), making it payable. */
  setBillerPayout: (id: string, p: { accountNumber: string; routingNumber: string; bankName?: string }) => Promise<boolean>;
  /** Pay a biller from Cash (USDC) via Bridge ACH. Returns success + an optional error message. */
  payViaUsdc: (billerId: string, amount: number, email: string) => Promise<{ success: boolean; message?: string }>;
  /** Record an on-time payment + accrue equity credits (called when the Pay flow completes). */
  recordBillPayment: (bill: Bill, paidAmount: number) => Promise<void>;
  /** Detect on-time recurring-bill payments from Plaid + accrue credits (Plaid call — Pay page only). */
  reconcile: () => Promise<void>;
  streak: number;
  refresh: () => void;
  /** Open the Pay flow; pass a bill id to go straight to that payment (e.g. "Pay rent"). */
  openPay: (billId?: string) => void;
}

const Ctx = createContext<PayValue | null>(null);

export function usePay(): PayValue {
  return (
    useContext(Ctx) ?? {
      bills: [],
      summary: null,
      loading: false,
      getBill: () => undefined,
      addBiller: () => '',
      updateBiller: () => {},
      removeBiller: () => {},
      setBillerPayout: async () => false,
      payViaUsdc: async () => ({ success: false }),
      recordBillPayment: async () => {},
      reconcile: async () => {},
      streak: ON_TIME_STREAK,
      refresh: () => {},
      openPay: () => {},
    }
  );
}

/**
 * Bills + billers store and the Clear Pay credit model — source of truth for the Pay page and the
 * Pay modal. Billers come from the backend ledger (Plaid-detected recurring outflows upserted on
 * load + manually-added billers); payments accrue equity credits server-side. See payLedgerStore.
 */
export function PayProvider({ children }: { children: ReactNode }) {
  const { gate } = useKyc();
  const { address, isConnected } = useAppKitAccount();
  const [bills, setBills] = useState<Bill[]>([]);
  const [summary, setSummary] = useState<PaySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [initialBillId, setInitialBillId] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (!isConnected || !address) {
      setBills([]);
      setSummary(null);
      return;
    }
    setLoading(true);
    try {
      // Plaid recurring detection is a best-effort SIDE EFFECT (upsert detected billers); never let it
      // wipe the list — getPayBillers below is the single source of truth (manual + detected).
      try {
        const rec = await getPlaidRecurringTransactions(address);
        const streams = (rec?.outflowStreams || []).map((s) => ({
          streamId: s.stream_id,
          name: s.name,
          amount: Math.abs(s.amount),
          dueDay: s.day,
          type: inferType(s.name),
        }));
        if (streams.length) await syncPlaidBillers(address, streams);
      } catch {
        /* Plaid optional (no linked item / env mismatch) — ignore */
      }
      const billers = await getPayBillers(address);
      setBills(billers.map(billerToBill));
      setSummary(await getPaySummary(address));
    } finally {
      setLoading(false);
    }
  }, [address, isConnected]);

  useEffect(() => {
    void load();
  }, [load]);

  // Optimistic add (temp id lets the Pay modal proceed); persists + refreshes in the background.
  const addBiller = useCallback(
    (b: BillerDraft) => {
      const tempId = `bill${Date.now()}`;
      setBills((bs) => [...bs, { ...b, id: tempId, icon: ICONS[b.type] ?? Receipt, source: 'manual', payable: false, payoutLast4: null, payoutBank: null }]);
      if (address) {
        void addPayBiller(address, { name: b.name, payee: b.payee, type: b.type, defaultAmount: b.amount, dueDay: b.dueDay }).then(() => load());
      }
      return tempId;
    },
    [address, load],
  );

  // Optimistic edit of a manual biller (auto-detected billers are server-guarded as read-only).
  const updateBiller = useCallback(
    (id: string, b: BillerDraft) => {
      setBills((bs) => bs.map((x) => (x.id === id && x.source === 'manual' ? { ...x, ...b, icon: ICONS[b.type] ?? Receipt } : x)));
      if (address && !id.startsWith('bill')) {
        void updatePayBiller(address, id, { name: b.name, payee: b.payee, type: b.type, defaultAmount: b.amount, dueDay: b.dueDay }).then(() => load());
      }
    },
    [address, load],
  );

  // Optimistic remove; persists the delete (skips temp/local-only billers not yet in the ledger).
  const removeBiller = useCallback(
    (id: string) => {
      setBills((bs) => bs.filter((b) => b.id !== id));
      if (address && !id.startsWith('bill')) {
        void deletePayBiller(address, id).then(() => load());
      }
    },
    [address, load],
  );

  const setBillerPayout = useCallback(
    async (id: string, p: { accountNumber: string; routingNumber: string; bankName?: string }) => {
      if (!address) return false;
      const updated = await setPayBillerPayout(address, id, p);
      await load();
      return !!updated;
    },
    [address, load],
  );

  // Pay a biller from Cash (USDC) → Bridge ACH. Server records the payment + accrues credits on success.
  const payViaUsdc = useCallback(
    async (billerId: string, amount: number, email: string) => {
      if (!address) return { success: false, message: 'Connect your wallet to pay.' };
      const res = await payBiller(address, { billerId, amount, source: 'usdc', email });
      if (res.success) await load();
      return { success: res.success, message: res.message };
    },
    [address, load],
  );

  const recordBillPayment = useCallback(
    async (bill: Bill, paidAmount: number) => {
      if (!address) return;
      const period = new Date().toISOString().slice(0, 7);
      await recordPayment(address, {
        // temp (local-only) billers aren't in the ledger yet → record as ad-hoc (null biller)
        billerId: bill.id.startsWith('bill') ? null : bill.id,
        name: bill.name,
        type: bill.type,
        amount: paidAmount,
        dueDate: bill.dueDay ? dueDateISO(bill.dueDay) : null,
        period,
        source: 'in_app',
      });
      await load();
    },
    [address, load],
  );

  // Plaid-backed detection of on-time recurring payments; refreshes the summary with any new credits.
  const reconcile = useCallback(async () => {
    if (!address) return;
    const s = await reconcilePay(address);
    if (s) setSummary(s);
  }, [address]);

  const value: PayValue = {
    bills,
    summary,
    loading,
    getBill: (id) => bills.find((b) => b.id === id),
    addBiller,
    updateBiller,
    removeBiller,
    setBillerPayout,
    payViaUsdc,
    recordBillPayment,
    reconcile,
    streak: summary?.streak ?? ON_TIME_STREAK,
    refresh: () => void load(),
    openPay: (billId) =>
      gate(() => {
        setInitialBillId(billId);
        setPayOpen(true);
      }),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <PayModal open={payOpen} onOpenChange={setPayOpen} initialBillId={initialBillId} />
    </Ctx.Provider>
  );
}
