import { getPayPool } from '../../config/postgres.js';
import { cardFeeCapExcess, liveFeeCents } from '../lithic/cardCreditFee.js';
import { creditBackCardCreditFee, isCardSettlementConfigured } from './cardSettlementService.js';

/*
 * The CFL cap on the card credit fee, applied when a cycle closes (MB-04 §5.4(f)).
 *
 * Carry plus the card credit fee may never exceed the CFL maximum on the principal, and any excess is
 * credited back by that cycle's statement at the latest. How the excess is measured is counsel's open
 * question (MB-04 #52), so `cardFeeCapExcess` (cardCreditFee.ts) returns 0 today and nothing is
 * credited. This is the path it will use the day it returns more: the cycle keeper calls it for every
 * member whose cycle it closes, and the excess is credited back on chain (`returnCardCreditFee`),
 * newest fee first, never more than a fee still owes.
 */

export interface FeeCapOutcome {
  wallet: string;
  excessCents: number;
  credited: Array<{ transactionToken: string; cents: number; action: string }>;
}

/** Spread an excess over fees, newest first, each up to what it still owes. Pure. */
export function allocateFeeCredit(
  fees: Array<{ transactionToken: string; liveCents: number; returnedCents: number }>,
  excessCents: number,
): Array<{ transactionToken: string; cents: number; totalCents: number }> {
  const out: Array<{ transactionToken: string; cents: number; totalCents: number }> = [];
  let left = Math.max(0, Math.round(excessCents));
  for (const fee of fees) {
    if (left <= 0) break;
    const take = Math.min(Math.max(0, fee.liveCents), left);
    if (take <= 0) continue;
    out.push({ transactionToken: fee.transactionToken, cents: take, totalCents: fee.returnedCents + take });
    left -= take;
  }
  return out;
}

/**
 * The hook the cycle keeper calls once it has closed a member's cycle. `cycleEndMs` is the cycle end
 * the chain judged. Never throws: a cap check that failed must not undo a cycle that closed.
 */
export async function applyCardFeeCapAtCycleClose(wallet: string, cycleEndMs: number): Promise<FeeCapOutcome> {
  const outcome: FeeCapOutcome = { wallet, excessCents: 0, credited: [] };
  const pool = getPayPool();
  if (!pool || !isCardSettlementConfigured()) return outcome;
  try {
    const { rows } = await pool.query<{
      transaction_token: string;
      fee_cents: string | number;
      fee_status: string;
      fee_returned_cents: string | number | null;
    }>(
      `SELECT transaction_token, fee_cents, fee_status, fee_returned_cents FROM lithic_auth_decisions
        WHERE wallet = $1 AND fee_status = 'charged' AND decided_at <= to_timestamp($2 / 1000.0)
        ORDER BY decided_at DESC`,
      [wallet.toLowerCase(), cycleEndMs],
    );
    const fees = rows.map((r) => ({
      transactionToken: r.transaction_token,
      liveCents: liveFeeCents(r.fee_cents, r.fee_status, r.fee_returned_cents),
      returnedCents: Number(r.fee_returned_cents ?? 0) || 0,
    }));
    const feesCents = fees.reduce((sum, f) => sum + f.liveCents, 0);
    if (feesCents <= 0) return outcome;

    // MB-04 §5.4(f); measurement pending counsel (MB-04 #52). 0 until then.
    outcome.excessCents = cardFeeCapExcess({
      wallet,
      cycleStartMs: 0,
      cycleEndMs,
      feesCents,
      carryCents: null,
      principalCents: null,
    });
    for (const share of allocateFeeCredit(fees, outcome.excessCents)) {
      const result = await creditBackCardCreditFee(share.transactionToken, share.totalCents, 'CFL cap (MB-04 §5.4(f))');
      outcome.credited.push({ transactionToken: share.transactionToken, cents: share.cents, action: result.action });
    }
  } catch (error) {
    console.error(`[card-credit-fee] cap check for ${wallet} failed:`, error);
  }
  return outcome;
}
