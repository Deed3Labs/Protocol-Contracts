/*
 * How an arriving deposit settles outstanding credit — spec step 4.
 *
 * Pure, like the authorization waterfall, and for the same reason: this decides how much of a
 * member's paycheck goes to which debt, and it should be provable rather than traced.
 *
 * Repayment runs in the OPPOSITE order to drawing. Draws take the cheapest tier first; settlement
 * clears the most expensive first, because that is what actually costs the member less. Boost at 3%
 * a cycle gets paid before asset-backed at 0.65%, and savings-backed — which is free — is paid last.
 * Repaying in draw order would look symmetrical and quietly leave the expensive balance running.
 *
 * This is the mechanism behind "there is no pay button": the deposit settles what is owed before
 * anything else touches it, so the equilibrium resolves itself.
 */

/** Most expensive first. The inverse of the draw order, deliberately. */
export const SETTLEMENT_ORDER = ['boost', 'income', 'asset', 'savings'] as const;
export type CreditTier = (typeof SETTLEMENT_ORDER)[number];

export type Outstanding = Record<CreditTier, number>;

export interface Settlement {
  tier: CreditTier;
  amountCents: number;
}

export interface SettlementPlan {
  settlements: Settlement[];
  /** Total applied to credit. */
  settledCents: number;
  /** What's left of the deposit once debts are cleared — the member's spendable cash. */
  remainingCents: number;
  /** Still owed after this deposit. Zero across the board means the cycle is clear. */
  outstandingAfter: Outstanding;
}

export function totalOutstanding(outstanding: Outstanding): number {
  return SETTLEMENT_ORDER.reduce((sum, tier) => sum + Math.max(0, outstanding[tier]), 0);
}

/**
 * Apply a deposit to outstanding credit, most expensive first.
 *
 * A deposit smaller than the debt settles what it can and leaves the rest owed — it never goes
 * negative, and it never leaves the member with cash while an expensive balance runs.
 */
export function planSettlement(depositCents: number, outstanding: Outstanding): SettlementPlan {
  const settlements: Settlement[] = [];
  const after: Outstanding = { ...outstanding };
  let remaining = Math.max(0, depositCents);
  let settled = 0;

  for (const tier of SETTLEMENT_ORDER) {
    if (remaining <= 0) break;
    const owed = Math.max(0, after[tier]);
    if (owed <= 0) continue;
    const pay = Math.min(owed, remaining);
    settlements.push({ tier, amountCents: pay });
    after[tier] = owed - pay;
    remaining -= pay;
    settled += pay;
  }

  return {
    settlements,
    settledCents: settled,
    remainingCents: remaining,
    outstandingAfter: after,
  };
}

/**
 * Split what's left between savings and cash.
 *
 * Auto-save runs on the remainder, not the gross deposit: sweeping a percentage of a paycheck into
 * savings while credit is still outstanding would have the member paying 3% to save at 0%. Debt
 * first, then the allocation, then whatever is left is theirs to spend.
 */
export interface AllocationInput {
  remainingCents: number;
  /** Fixed amount per deposit, in cents. Ignored when zero. */
  autoSaveCents?: number;
}

export interface Allocation {
  toSavingsCents: number;
  toCashCents: number;
}

export function allocate({ remainingCents, autoSaveCents = 0 }: AllocationInput): Allocation {
  const available = Math.max(0, remainingCents);
  // Never overdraw the remainder to hit a savings target — the same rule the auto-save surface
  // promises the member: "if your balance is short on the day, we skip it rather than overdraw you."
  const toSavings = Math.min(Math.max(0, autoSaveCents), available);
  return { toSavingsCents: toSavings, toCashCents: available - toSavings };
}
