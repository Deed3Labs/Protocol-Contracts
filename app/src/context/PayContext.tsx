import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Home, Zap, Repeat, CreditCard, Smartphone, Receipt, type LucideIcon } from 'lucide-react';
import { useAppKitAccount } from '@/lib/walletCompat';
import PayModal from '@/components/app-ui/PayModal';
import BillPortalsModal from '@/components/app-ui/BillPortalsModal';
import { useKyc } from '@/context/KycContext';
import {
  getPlaidRecurringTransactions,
  getPayBillers,
  getPaySummary,
  addPayBiller,
  updatePayBiller,
  deletePayBiller,
  setPayBillerPayout,
  setPayBillerReminders,
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
  portalUrl: string | null; // biller's login/pay page → "Pay on their site"
  address: string | null; // mailing address (biller info; future mailed-check option)
  reminders: boolean; // due-date reminders on/off
}

/** Fields a user can set/edit on a biller (id/icon derived; source/payable/payout/reminders server-controlled). */
export type BillerDraft = Omit<Bill, 'id' | 'icon' | 'source' | 'payable' | 'payoutLast4' | 'payoutBank' | 'reminders'>;

/** On-time streak fallback when no summary is loaded yet. */
export const ON_TIME_STREAK = 0;

/** Non-rent bills earn 10% of the payment as base credits (capped); rent earns a flat base. */
export const BILL_CREDIT_RATE = 0.1;
export const BILL_CREDIT_CAP = 500;
export const RENT_BASE_CREDITS = 200;
export const MAX_MULTIPLIER = 1.5;

/**
 * Reward multiplier: Accelerated-track members get the full 1.5×; standard members ramp toward it with
 * their on-time streak (+0.25× every 6 on-time months, capped at 1.5×). Mirrors the backend.
 */
export const rewardMultiplier = (streak = ON_TIME_STREAK, accelerated = false) =>
  accelerated ? MAX_MULTIPLIER : Math.min(1 + Math.floor(Math.max(streak, 0) / 6) * 0.25, MAX_MULTIPLIER);

/**
 * Clear Pay equity credits for paying a bill ON TIME (preview of what the backend awards). Rent: flat
 * 200 base. Non-rent bills: 10% of the payment (base capped at 500). Both × the reward multiplier
 * (1.0–1.5, from the on-time streak or Accelerated track). NON-redeemable — credits only count toward
 * the Clear Deed milestone. Never interest/APY. Pass `amount` for the exact payment; else the default.
 */
export const creditsFor = (bill: Pick<Bill, 'type' | 'amount'>, streak = ON_TIME_STREAK, amount = 0, accelerated = false) => {
  const mult = rewardMultiplier(streak, accelerated);
  const base = bill.type === 'rent' ? RENT_BASE_CREDITS : Math.min((amount > 0 ? amount : bill.amount || 0) * BILL_CREDIT_RATE, BILL_CREDIT_CAP);
  return Math.round(base * mult);
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
    portalUrl: b.portalUrl,
    address: b.address,
    reminders: b.reminders,
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
  /** Toggle due-date reminders for a biller (optimistic; persists in background). */
  setReminders: (id: string, enabled: boolean) => void;
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
  /** Open the bill-portal directory (pay on the biller's own site with the Clear card). */
  openPortals: () => void;
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
      setReminders: () => {},
      payViaUsdc: async () => ({ success: false }),
      recordBillPayment: async () => {},
      reconcile: async () => {},
      streak: ON_TIME_STREAK,
      refresh: () => {},
      openPay: () => {},
      openPortals: () => {},
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
  const [portalsOpen, setPortalsOpen] = useState(false);
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

  // Lightweight refresh (summary + billers, NO Plaid sync) for polling/focus — so equity credits and
  // bill state update automatically after payments/deposits without a manual reload.
  const refreshSummary = useCallback(async () => {
    if (!isConnected || !address) return;
    try {
      const [billers, sum] = await Promise.all([getPayBillers(address), getPaySummary(address)]);
      setBills(billers.map(billerToBill));
      setSummary(sum);
    } catch {
      /* best-effort */
    }
  }, [address, isConnected]);

  useEffect(() => {
    if (!isConnected || !address) return;
    const id = setInterval(() => void refreshSummary(), 45_000);
    const onFocus = () => void refreshSummary();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshSummary, isConnected, address]);

  // Just the summary stats (credits / due / timeline) — used after a mutation so the dashboard updates
  // WITHOUT re-fetching (and clobbering) the optimistic biller list.
  const refreshSummaryOnly = useCallback(async () => {
    if (!isConnected || !address) return;
    try {
      setSummary(await getPaySummary(address));
    } catch {
      /* best-effort */
    }
  }, [address, isConnected]);

  // Maps the optimistic temp id → the real server id so an edit/delete/payout done before the next
  // full reload still targets the right row (and so the open modal can keep using the temp id).
  const realIdRef = useRef<Map<string, string>>(new Map());
  const resolveId = useCallback((id: string) => realIdRef.current.get(id) ?? id, []);

  // Optimistic add: show immediately, then reconcile from the SERVER RESPONSE (no full reload — that
  // re-ran the Plaid sync and could clear the list, which is why adds appeared to need a refresh).
  const addBiller = useCallback(
    (b: BillerDraft) => {
      const tempId = `bill${Date.now()}`;
      setBills((bs) => [...bs, { ...b, id: tempId, icon: ICONS[b.type] ?? Receipt, source: 'manual', payable: false, payoutLast4: null, payoutBank: null, reminders: true }]);
      if (address) {
        void addPayBiller(address, { name: b.name, payee: b.payee, type: b.type, defaultAmount: b.amount, dueDay: b.dueDay, portalUrl: b.portalUrl, address: b.address })
          .then((created) => {
            if (created) {
              realIdRef.current.set(tempId, created.id); // keep tempId in the UI, target realId server-side
              setBills((bs) => bs.map((x) => (x.id === tempId ? { ...billerToBill(created), id: tempId } : x)));
            } else {
              setBills((bs) => bs.filter((x) => x.id !== tempId)); // add failed → drop the optimistic row
            }
            void refreshSummaryOnly();
          })
          .catch(() => setBills((bs) => bs.filter((x) => x.id !== tempId)));
      }
      return tempId;
    },
    [address, refreshSummaryOnly],
  );

  // Optimistic edit of a manual biller (auto-detected billers are server-guarded as read-only).
  const updateBiller = useCallback(
    (id: string, b: BillerDraft) => {
      setBills((bs) => bs.map((x) => (x.id === id && x.source === 'manual' ? { ...x, ...b, icon: ICONS[b.type] ?? Receipt } : x)));
      const realId = resolveId(id);
      if (address && !realId.startsWith('bill')) {
        void updatePayBiller(address, realId, { name: b.name, payee: b.payee, type: b.type, defaultAmount: b.amount, dueDay: b.dueDay, portalUrl: b.portalUrl, address: b.address }).then(
          () => refreshSummaryOnly(),
        );
      }
    },
    [address, refreshSummaryOnly, resolveId],
  );

  // Optimistic reminders toggle (any biller); persists in the background.
  const setReminders = useCallback(
    (id: string, enabled: boolean) => {
      setBills((bs) => bs.map((x) => (x.id === id ? { ...x, reminders: enabled } : x)));
      const realId = resolveId(id);
      if (address && !realId.startsWith('bill')) void setPayBillerReminders(address, realId, enabled);
    },
    [address, resolveId],
  );

  // Optimistic remove; persists the delete (skips temp/local-only billers not yet in the ledger).
  const removeBiller = useCallback(
    (id: string) => {
      setBills((bs) => bs.filter((b) => b.id !== id));
      const realId = resolveId(id);
      realIdRef.current.delete(id);
      if (address && !realId.startsWith('bill')) {
        void deletePayBiller(address, realId).then(() => refreshSummaryOnly());
      }
    },
    [address, refreshSummaryOnly, resolveId],
  );

  const setBillerPayout = useCallback(
    async (id: string, p: { accountNumber: string; routingNumber: string; bankName?: string }) => {
      if (!address) return false;
      const updated = await setPayBillerPayout(address, resolveId(id), p);
      // Reflect the new payout on the (temp-or-real) row immediately, keeping its current UI id.
      if (updated) setBills((bs) => bs.map((x) => (x.id === id ? { ...billerToBill(updated), id } : x)));
      void refreshSummaryOnly();
      return !!updated;
    },
    [address, refreshSummaryOnly, resolveId],
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
    setReminders,
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
    openPortals: () => gate(() => setPortalsOpen(true)),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <PayModal open={payOpen} onOpenChange={setPayOpen} initialBillId={initialBillId} />
      <BillPortalsModal open={portalsOpen} onOpenChange={setPortalsOpen} />
    </Ctx.Provider>
  );
}
