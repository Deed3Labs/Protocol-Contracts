import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Zap, Lock, Users, Wallet, Tag, type LucideIcon } from 'lucide-react';
import BorrowModal from '@/components/app-ui/BorrowModal';
import { useAppKitAccount } from '@/lib/walletCompat';
import { onChainStale } from '@/lib/chainStale';
import { getCredit, type CreditState } from '@/utils/apiClient';
import { toCycle } from '@/lib/creditMapping';
import { keepLastGood } from '@/lib/keepLastGood';

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
 * The member's credit line, read from the contracts.
 *
 * The model: the base line is the Stable/Mutual credit line — borrow overdrafts to a negative
 * balance, repay returns it to zero. No interest, a flat fee per draw. Credit CYCLES rather than
 * due dates: clear the balance within the cycle to keep full borrowing power. Purpose lines are
 * UI-only buckets a member creates to organise one underlying line.
 *
 * ## This used to be a fixture, and it was one `openBorrow()` away from a member
 *
 * It shipped a $5,000 base limit, three purpose lines and $1,200 already borrowed — hardcoded, for
 * everybody. Nothing calls `openBorrow` yet, so no member has seen it, which is luck rather than
 * design: wiring up a Borrow button would have shown every member somebody else's credit line
 * rendered as their own. The route containers next door go to some length to avoid exactly that
 * (`*_DAY_ONE` over `*_IN_USE`, "each field only overrides once it has been read"), and this
 * context sat inside the same shell contradicting them.
 *
 * So the figures come from /api/credit now — the same read HomeRoute does, which also means the
 * limit here cannot disagree with the limit on the home screen. Two sources for one number is the
 * failure this codebase keeps producing.
 */
export const BASE_DRAW_FEE = 0.01; // 1% flat fee per draw, no interest
export const CYCLE_LENGTH_DAYS = 30;

/*
 * Product copy, deliberately with no `limit`.
 *
 * The names and terms are real product decisions. The limits attached to them were not — "Cash
 * Advance, $1,500" is a number nobody has underwritten, and it was being summed into `totalPower`
 * as though it were headroom the member had.
 */
const PRODUCTS: CreditProduct[] = [
  { id: 'cash', name: 'Cash Advance', desc: 'Quick personal loan, straight to your balance.', status: 'available', terms: '1.5% flat fee · no interest', icon: Zap },
  { id: 'secured', name: 'Secured Line', desc: 'A higher limit backed by your savings or assets.', status: 'available', terms: 'Flat fee · no interest', icon: Lock },
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
  const value = useContext(Ctx);
  if (!value) {
    // Same reasoning as useClearBalances: a silent stub here is a credit line of zero presented as
    // fact. BorrowModal is rendered by CreditProvider itself, so nothing can legitimately miss it.
    throw new Error('useCredit must be used within a CreditProvider (mounted in AppShell)');
  }
  return value;
}

export function CreditProvider({ children }: { children: ReactNode }) {
  const { address } = useAppKitAccount();
  const [credit, setCredit] = useState<CreditState | null>(null);
  const [extraLines, setExtraLines] = useState<PurposeLine[]>([]);
  const [mode, setMode] = useState<'borrow' | 'repay'>('borrow');
  const [open, setOpen] = useState(false);
  const [activeLineId, setActiveLineId] = useState('general');

  /*
   * The same read HomeRoute does, and re-read on the same signal.
   *
   * Not a second fetch of a different thing: literally the same endpoint, so the limit in a Borrow
   * sheet cannot disagree with the limit on the home screen. Without the stale listener this
   * context had no refresh path at all — it read once on mount and then described a past.
   */
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const read = () => {
      void getCredit(address).then((result) => {
        if (cancelled) return;
        /*
         * A failed read must not replace figures that worked.
         *
         * `complete: false` does not mean "this member has no credit line" -- an empty line reads as
         * a complete result with no tiers. It means the chain read errored, and under rate limiting
         * that happened often. Assigning it anyway blanked every tier, so the limit fell to zero and
         * came back on the next successful read: not a stale number, a wrong one, flickering. Two
         * separate reports of the credit component "showing the wrong thing" were this.
         *
         * Keeping the last good value is honest in a way zero is not. The figures are from a moment
         * ago rather than from now, which is the ordinary condition of anything read over a network;
         * zero is a claim about the member's money that was never true.
         */
        setCredit((prev) => keepLastGood(prev, result));
      });
    };
    read();
    const stopListening = onChainStale(read);
    return () => {
      cancelled = true;
      stopListening();
    };
  }, [address]);

  // Only tiers the issuer has actually activated. An inactive tier is a product the member could
  // have, not headroom they do have.
  const activeTiers = (credit?.complete ? credit.tiers : []).filter((tier) => tier.active);
  const baseLimit = activeTiers.reduce((sum, tier) => sum + tier.limitCents, 0) / 100;
  const borrowed = activeTiers.reduce((sum, tier) => sum + tier.usedCents, 0) / 100;
  const available = Math.max(0, baseLimit - borrowed);
  // Through the same mapper HomeRoute uses, rather than re-deriving days-from-expiry here. The
  // arithmetic is small; having two copies of it that can disagree is not.
  const cycleDaysLeft = toCycle(credit?.cycle ?? null, {
    lengthDays: CYCLE_LENGTH_DAYS,
    daysLeft: 0,
    clearsOn: '—',
    rebalanceBy: '—',
  }).daysLeft;
  // Full power until the contracts say otherwise. Nothing on chain reports this yet, so the honest
  // value is "no penalty recorded" rather than a percentage invented here.
  const powerPct = 100;
  // What the member can draw, and nothing else. This used to add every product's hardcoded limit,
  // so it reported borrowing power nobody had underwritten.
  const totalPower = available;

  /*
   * One real line, plus any buckets the member has made.
   *
   * There is a single underlying credit line; purpose lines are a UI device for splitting it. The
   * default one therefore *is* the line — its limit and usage are the contract's, not a slice
   * invented here — and it starts as the only one, because a new member has not made any.
   */
  const lines: PurposeLine[] = [
    { id: 'general', name: 'General', limit: baseLimit, used: borrowed, icon: Wallet },
    ...extraLines,
  ];
  const setLines = setExtraLines;

  /*
   * Not built, and now it says so.
   *
   * These moved a number in local state and nothing else — no draw against StableCredit, no
   * transfer, no receipt. A member who pressed Borrow would have watched their balance rise and
   * their credit fall on screen while nothing whatsoever happened on chain, and the figures would
   * have snapped back on the next read with no explanation.
   *
   * Throwing is safe: nothing calls `openBorrow`, so the modal these belong to cannot be opened
   * today. It is also the point — whoever wires the Borrow button up should hit this immediately
   * rather than ship a convincing mime of a loan.
   */
  const notBuilt = (action: string) => (): never => {
    throw new Error(
      `${action} is not implemented: it needs a StableCredit draw/repay on chain. ` +
        'This context reads the line; it cannot move it.',
    );
  };
  const borrow = notBuilt('borrow');
  const repay = notBuilt('repay');

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
    openBorrow: (lineId) => {
      // borrow/repay are on-chain Stable Credit moves — no KYC gate.
      setMode('borrow');
      setActiveLineId(lineId ?? lines[0]?.id ?? 'general');
      setOpen(true);
    },
    openRepay: (lineId) => {
      setMode('repay');
      setActiveLineId(lineId ?? lines.find((l) => l.used > 0)?.id ?? lines[0]?.id ?? 'general');
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
