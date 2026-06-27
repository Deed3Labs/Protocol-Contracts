import { createContext, useContext, useState, type ReactNode } from 'react';
import { Zap, Lock, Users, Wallet, ShoppingBag, Home, Tag, type LucideIcon } from 'lucide-react';
import BorrowModal from '@/components/app-ui/BorrowModal';
import { useKyc } from '@/context/KycContext';

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

/** A user-facing "purpose line" — a named allocation OF the one base credit line (more control,
 *  same backend line). `limit` is the slice of the base limit assigned to it; `used` is borrowed. */
export interface PurposeLine {
  id: string;
  name: string;
  limit: number;
  used: number;
  icon: LucideIcon;
}

/**
 * Mock credit model. The base line is the Stable/Mutual credit line: borrow = overdraft to a
 * negative balance, repay = back to 0. NO interest — a flat fee per draw. Limit backed by the
 * CLRUSD (Savings) balance 1:1. Credit CYCLES (not due dates): balance to 0 within the cycle to
 * keep full borrowing power. Users organize borrowing into PURPOSE LINES (allocations of the one
 * base line) for control. All abstracted as USD.
 */
export const CLRUSD_BALANCE = 5000; // Savings balance — backs the base limit 1:1
export const BASE_DRAW_FEE = 0.01; // 1% flat fee per draw, no interest
export const CYCLE_LENGTH_DAYS = 30;

const PRODUCTS: CreditProduct[] = [
  { id: 'cash', name: 'Cash Advance', desc: 'Quick personal loan, straight to your balance.', limit: 1500, status: 'available', terms: '1.5% flat fee · no interest', icon: Zap },
  { id: 'secured', name: 'Secured Line', desc: 'A higher limit backed by your savings or assets.', limit: 5000, status: 'available', terms: 'Flat fee · no interest', icon: Lock },
  { id: 'pool', name: 'Community Pool', desc: 'Borrow from — or lend to — the member pool to earn rewards.', status: 'soon', terms: 'Earn reward yield', icon: Users },
];

const SEED_LINES: PurposeLine[] = [
  { id: 'general', name: 'General', limit: 2000, used: 400, icon: Wallet },
  { id: 'everyday', name: 'Everyday', limit: 1500, used: 800, icon: ShoppingBag },
  { id: 'rent', name: 'Rent buffer', limit: 1500, used: 0, icon: Home },
];

interface CreditValue {
  baseLimit: number;
  borrowed: number;
  available: number;
  cycleDaysLeft: number;
  cycleLength: number;
  powerPct: number;
  products: CreditProduct[];
  totalPower: number;
  lines: PurposeLine[];
  activeLineId: string;
  addPurposeLine: (name: string, limit: number) => void;
  removePurposeLine: (id: string) => void;
  borrow: (amount: number, lineId: string) => void;
  repay: (amount: number, lineId: string) => void;
  openBorrow: (lineId?: string) => void;
  openRepay: (lineId?: string) => void;
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
      lines: [],
      activeLineId: '',
      addPurposeLine: () => {},
      removePurposeLine: () => {},
      borrow: () => {},
      repay: () => {},
      openBorrow: () => {},
      openRepay: () => {},
    }
  );
}

export function CreditProvider({ children }: { children: ReactNode }) {
  const { gate } = useKyc();
  const [lines, setLines] = useState<PurposeLine[]>(SEED_LINES);
  const [mode, setMode] = useState<'borrow' | 'repay'>('borrow');
  const [open, setOpen] = useState(false);
  const [activeLineId, setActiveLineId] = useState('general');

  const baseLimit = CLRUSD_BALANCE;
  const borrowed = lines.reduce((s, l) => s + l.used, 0);
  const available = Math.max(0, baseLimit - borrowed);
  const cycleDaysLeft = 18;
  const powerPct = 100; // good standing (mock) — shrinks if you don't balance within the cycle
  const totalPower = available + PRODUCTS.filter((p) => p.status === 'available').reduce((s, p) => s + (p.limit ?? 0), 0);

  const borrow = (amount: number, lineId: string) =>
    setLines((ls) => {
      const room = Math.max(0, baseLimit - ls.reduce((s, l) => s + l.used, 0)); // global headroom
      return ls.map((l) =>
        l.id === lineId ? { ...l, used: l.used + Math.min(amount, Math.max(0, l.limit - l.used), room) } : l,
      );
    });
  const repay = (amount: number, lineId: string) =>
    setLines((ls) => ls.map((l) => (l.id === lineId ? { ...l, used: Math.max(0, l.used - amount) } : l)));

  const value: CreditValue = {
    baseLimit,
    borrowed,
    available,
    cycleDaysLeft,
    cycleLength: CYCLE_LENGTH_DAYS,
    powerPct,
    products: PRODUCTS,
    totalPower,
    lines,
    activeLineId,
    addPurposeLine: (name, limit) => setLines((ls) => [...ls, { id: `line${Date.now()}`, name, limit, used: 0, icon: Tag }]),
    removePurposeLine: (id) => setLines((ls) => ls.filter((l) => l.id !== id)),
    borrow,
    repay,
    openBorrow: (lineId) =>
      gate(() => {
        setMode('borrow');
        setActiveLineId(lineId ?? lines[0]?.id ?? 'general');
        setOpen(true);
      }),
    openRepay: (lineId) =>
      gate(() => {
        setMode('repay');
        setActiveLineId(lineId ?? lines.find((l) => l.used > 0)?.id ?? lines[0]?.id ?? 'general');
        setOpen(true);
      }),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <BorrowModal open={open} onOpenChange={setOpen} mode={mode} />
    </Ctx.Provider>
  );
}
