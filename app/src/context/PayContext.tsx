import { createContext, useContext, useState, type ReactNode } from 'react';
import { Home, Zap, Wifi, CreditCard, Smartphone, Receipt, type LucideIcon } from 'lucide-react';
import PayModal from '@/components/app-ui/PayModal';

export type BillType = 'rent' | 'utility' | 'card' | 'phone' | 'other';

export interface Bill {
  id: string;
  name: string; // "Electric — ConEd"
  payee: string; // "ConEd"
  type: BillType;
  amount: number;
  dueLabel: string; // "Jun 28"
  icon: LucideIcon;
}

/** On-time streak (months) — drives the Clear Pay credit multiplier. Mock; from payment history. */
export const ON_TIME_STREAK = 6;

/** Streak multiplier: +5% per on-time month, capped at 12 months (1.0×–1.6×). */
export const streakMultiplier = (streak = ON_TIME_STREAK) => 1 + Math.min(Math.max(streak, 0), 12) * 0.05;

/**
 * Clear Pay equity credits earned for paying a bill ON TIME. Flat base by type (rent rewards
 * most; bills earn too, lower) × the on-time streak multiplier, rounded to 5. NON-redeemable —
 * credits only count toward the Clear Deed milestone. Never interest/APY.
 */
export const creditsFor = (bill: Pick<Bill, 'type'>, streak = ON_TIME_STREAK) => {
  const base = bill.type === 'rent' ? 300 : 50;
  return Math.round((base * streakMultiplier(streak)) / 5) * 5;
};

interface PayValue {
  bills: Bill[];
  getBill: (id: string) => Bill | undefined;
  addBiller: (b: Omit<Bill, 'id' | 'icon'>) => string;
  streak: number;
  /** Open the Pay flow; pass a bill id to go straight to that payment (e.g. "Pay rent"). */
  openPay: (billId?: string) => void;
}

const Ctx = createContext<PayValue | null>(null);

export function usePay(): PayValue {
  return (
    useContext(Ctx) ?? {
      bills: [],
      getBill: () => undefined,
      addBiller: () => '',
      streak: ON_TIME_STREAK,
      openPay: () => {},
    }
  );
}

const SEED: Bill[] = [
  { id: 'rent', name: 'Rent — Maple Apartments', payee: 'Maple Apartments', type: 'rent', amount: 1850, dueLabel: 'Jul 1', icon: Home },
  { id: 'electric', name: 'Electric — ConEd', payee: 'ConEd', type: 'utility', amount: 124, dueLabel: 'Jun 28', icon: Zap },
  { id: 'internet', name: 'Internet — Verizon', payee: 'Verizon', type: 'utility', amount: 80, dueLabel: 'Jun 30', icon: Wifi },
  { id: 'card', name: 'Card — Amex', payee: 'Amex', type: 'card', amount: 320, dueLabel: 'Jul 3', icon: CreditCard },
  { id: 'phone', name: 'Phone — Verizon', payee: 'Verizon', type: 'phone', amount: 65, dueLabel: 'Jul 5', icon: Smartphone },
];

/**
 * Bills + billers store and the Clear Pay credit model — source of truth for the Pay page and
 * the (adaptive) Pay modal. Rent gets the equity/Clear Deed treatment; bills are lighter but
 * still earn credits. Mock/local; wire to the Clear Pay rent-routing + biller backend later.
 */
export function PayProvider({ children }: { children: ReactNode }) {
  const [bills, setBills] = useState<Bill[]>(SEED);
  const [payOpen, setPayOpen] = useState(false);
  const [initialBillId, setInitialBillId] = useState<string | undefined>(undefined);

  const addBiller = (b: Omit<Bill, 'id' | 'icon'>) => {
    const id = `bill${Date.now()}`;
    setBills((bs) => [...bs, { ...b, id, icon: Receipt }]);
    return id;
  };

  const value: PayValue = {
    bills,
    getBill: (id) => bills.find((b) => b.id === id),
    addBiller,
    streak: ON_TIME_STREAK,
    openPay: (billId) => {
      setInitialBillId(billId);
      setPayOpen(true);
    },
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <PayModal open={payOpen} onOpenChange={setPayOpen} initialBillId={initialBillId} />
    </Ctx.Provider>
  );
}
