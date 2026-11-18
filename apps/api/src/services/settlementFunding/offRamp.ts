/*
 * The off-ramp (decision 54, spec part 4): USDC in, dollars out to the Credit Settlement Account.
 *
 * The SettlementForwarder sends USDC from CL Operating to one fixed deposit address, set by CL
 * Operating's owners. The provider turns every deposit there into a payout to the CSA, which it holds
 * as an external account. The desk only watches: it never instructs the provider per payout, so a
 * stolen desk key can reach nothing but that address, within the allowance.
 *
 * Implementations:
 *   bridge  a Bridge liquidation address bound to the CSA (offRampBridge.ts);
 *   mock    for Base Sepolia, where no sandbox pays a real bank: a deposit "arrives" after the
 *           configured latency (offRampMock.ts).
 *
 * Measured latency (forward mined -> payout processed, from the desk's own records) feeds the
 * Settlement Buffer and the forced run's time (desk.ts `figures`).
 */

export type PayoutState = 'in-flight' | 'arrived' | 'failed';

export interface OffRampPayout {
  /** The provider's id for the payout (a Bridge drain id). */
  id: string;
  /** USDC base units. */
  amount: bigint;
  state: PayoutState;
  /** The deposit's transaction hash, when the provider reports it. */
  depositTx: string | null;
  /** Unix seconds. */
  createdAt: number;
  /** When the provider reports the payout processed, unix seconds. */
  arrivedAt: number | null;
  /** The provider's own state word, for records and alerts. */
  detail: string;
}

export interface OffRamp {
  name: 'bridge' | 'mock';
  /** The deposit address the SettlementForwarder pays. */
  address: string;
  /** The payout rail (wire, ach_same_day, ach, ...), as the provider names it. */
  rail: string;
  /** Payouts created since `since` (unix seconds). */
  payouts(since: number): Promise<OffRampPayout[]>;
}

/** A forwarded deposit, as the desk recorded it. */
export interface ForwardedDeposit {
  forwardTx: string | null;
  amount: bigint;
  /** Unix seconds. */
  forwardedAt: number;
}

/**
 * The provider's payout for a deposit: by its transaction hash when the provider reports one, else
 * the oldest payout of exactly that amount created after it was forwarded and not already taken.
 */
export function matchPayout(deposit: ForwardedDeposit, payouts: OffRampPayout[], taken: Set<string> = new Set()): OffRampPayout | null {
  const tx = deposit.forwardTx?.toLowerCase();
  if (tx) {
    const byHash = payouts.find((p) => p.depositTx?.toLowerCase() === tx);
    if (byHash) return byHash;
  }
  return (
    payouts
      .filter((p) => !taken.has(p.id) && !p.depositTx && p.amount === deposit.amount && p.createdAt >= deposit.forwardedAt - 300)
      .sort((x, y) => x.createdAt - y.createdAt)[0] ?? null
  );
}
