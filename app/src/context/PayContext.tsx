import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Home, Zap, CreditCard, Smartphone, Receipt, type LucideIcon } from 'lucide-react';
import { useAppKitAccount } from '@reown/appkit/react';
import PayModal from '@/components/app-ui/PayModal';
import { useKyc } from '@/context/KycContext';
import {
  getPlaidRecurringTransactions,
  getPayBillers,
  getPaySummary,
  addPayBiller,
  syncPlaidBillers,
  recordPayment,
  type PayBiller,
  type PaySummary,
} from '@/utils/apiClient';

export type BillType = 'rent' | 'utility' | 'card' | 'phone' | 'other';

export interface Bill {
  id: string;
  name: string; // "Electric — ConEd"
  payee: string; // "ConEd"
  type: BillType;
  amount: number;
  dueLabel: string; // "Jun 28"
  dueDay: number | null; // 1-31, for due-date math
  icon: LucideIcon;
}

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

const ICONS: Record<BillType, LucideIcon> = { rent: Home, utility: Zap, card: CreditCard, phone: Smartphone, other: Receipt };

function inferType(name: string): BillType {
  const s = name.toLowerCase();
  if (/rent|apartment|property|lease|landlord|housing/.test(s)) return 'rent';
  if (/electric|gas|water|utility|energy|internet|wifi|broadband|coned|pg&e/.test(s)) return 'utility';
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
  };
}

interface PayValue {
  bills: Bill[];
  summary: PaySummary | null;
  loading: boolean;
  getBill: (id: string) => Bill | undefined;
  addBiller: (b: Omit<Bill, 'id' | 'icon'>) => string;
  /** Record an on-time payment + accrue equity credits (called when the Pay flow completes). */
  recordBillPayment: (bill: Bill, paidAmount: number) => Promise<void>;
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
      recordBillPayment: async () => {},
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
      let billers: PayBiller[] = [];
      try {
        const rec = await getPlaidRecurringTransactions(address);
        const streams = (rec?.outflowStreams || []).map((s) => ({
          streamId: s.stream_id,
          name: s.name,
          amount: Math.abs(s.amount),
          dueDay: s.day,
          type: inferType(s.name),
        }));
        billers = streams.length ? await syncPlaidBillers(address, streams) : await getPayBillers(address);
      } catch {
        billers = await getPayBillers(address);
      }
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
    (b: Omit<Bill, 'id' | 'icon'>) => {
      const tempId = `bill${Date.now()}`;
      setBills((bs) => [...bs, { ...b, id: tempId, icon: ICONS[b.type] ?? Receipt }]);
      if (address) {
        void addPayBiller(address, { name: b.name, payee: b.payee, type: b.type, defaultAmount: b.amount, dueDay: b.dueDay }).then(() => load());
      }
      return tempId;
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

  const value: PayValue = {
    bills,
    summary,
    loading,
    getBill: (id) => bills.find((b) => b.id === id),
    addBiller,
    recordBillPayment,
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
