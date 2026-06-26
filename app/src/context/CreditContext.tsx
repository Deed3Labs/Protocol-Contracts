import { createContext, useContext, useState, type ReactNode } from 'react';
import { Zap, Lock, Users, type LucideIcon } from 'lucide-react';
import BorrowModal from '@/components/app-ui/BorrowModal';

export type ProductStatus = 'available' | 'active' | 'soon';
export interface CreditProduct {
  id: string;
  name: string;
  desc: string;
  limit?: number;
  status: ProductStatus;
  terms: string;
  icon: LucideIcon;
}

/**
 * Mock credit model. The base line is the Stable/Mutual credit line: borrow = overdraft to a
 * negative balance, repay = return to 0. NO interest — a flat fee per draw. The limit is backed
 * by the CLRUSD (Savings) balance 1:1 (grow savings → bigger line). Credit CYCLES (not hard due
 * dates): balance back to 0 within the cycle to keep full borrowing power. All abstracted as USD.
 */
export const CLRUSD_BALANCE = 5000; // Savings balance — backs the base limit 1:1
export const BASE_DRAW_FEE = 0.01; // 1% flat fee per draw, no interest
export const CYCLE_LENGTH_DAYS = 30;

const PRODUCTS: CreditProduct[] = [
  { id: 'cash', name: 'Cash Advance', desc: 'Quick personal loan, straight to your balance.', limit: 1500, status: 'available', terms: '1.5% flat fee · no interest', icon: Zap },
  { id: 'secured', name: 'Secured Line', desc: 'A higher limit backed by your savings or assets.', limit: 5000, status: 'available', terms: 'Flat fee · no interest', icon: Lock },
  { id: 'pool', name: 'Community Pool', desc: 'Borrow from — or lend to — the member pool to earn rewards.', status: 'soon', terms: 'Earn reward yield', icon: Users },
];

interface CreditValue {
  baseLimit: number;
  borrowed: number;
  available: number;
  cycleDaysLeft: number;
  cycleLength: number;
  powerPct: number;
  products: CreditProduct[];
  /** Total borrowing power across the base line + activatable products. */
  totalPower: number;
  borrow: (amount: number) => void;
  repay: (amount: number) => void;
  openBorrow: () => void;
  openRepay: () => void;
}

const Ctx = createContext<CreditValue | null>(null);

export function useCredit(): CreditValue {
  return (
    useContext(Ctx) ?? {
      baseLimit: 0,
      borrowed: 0,
      available: 0,
      cycleDaysLeft: CYCLE_LENGTH_DAYS,
      cycleLength: CYCLE_LENGTH_DAYS,
      powerPct: 100,
      products: [],
      totalPower: 0,
      borrow: () => {},
      repay: () => {},
      openBorrow: () => {},
      openRepay: () => {},
    }
  );
}

export function CreditProvider({ children }: { children: ReactNode }) {
  const [borrowed, setBorrowed] = useState(1200);
  const [mode, setMode] = useState<'borrow' | 'repay'>('borrow');
  const [open, setOpen] = useState(false);

  const baseLimit = CLRUSD_BALANCE;
  const available = Math.max(0, baseLimit - borrowed);
  const cycleDaysLeft = 18;
  const powerPct = 100; // good standing (mock) — shrinks if you don't balance within the cycle
  const totalPower = available + PRODUCTS.filter((p) => p.status === 'available').reduce((s, p) => s + (p.limit ?? 0), 0);

  const value: CreditValue = {
    baseLimit,
    borrowed,
    available,
    cycleDaysLeft,
    cycleLength: CYCLE_LENGTH_DAYS,
    powerPct,
    products: PRODUCTS,
    totalPower,
    borrow: (amount) => setBorrowed((b) => Math.min(baseLimit, b + amount)),
    repay: (amount) => setBorrowed((b) => Math.max(0, b - amount)),
    openBorrow: () => {
      setMode('borrow');
      setOpen(true);
    },
    openRepay: () => {
      setMode('repay');
      setOpen(true);
    },
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <BorrowModal open={open} onOpenChange={setOpen} mode={mode} />
    </Ctx.Provider>
  );
}
