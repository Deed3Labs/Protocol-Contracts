import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';

/*
 * What the PayoutPool needs funded soon (Phase 2b, section 12.10).
 *
 * Claims are paid by deadline first, then FIFO among claims sharing a deadline, and Lending Co.
 * funds the pool so shops are paid on time. `PayoutPool.dueWithin(horizon, maxClaims)` says which
 * claims fall due inside a horizon (overdue ones included), what they add up to, and what the pool
 * is short of paying them after refunds owed to members. Business days are the operator's to count;
 * the contract takes plain seconds, so this turns "two business days" into a horizon, and the money
 * should be there before the first of those deadlines.
 *
 * An inline fragment, checked against PayoutPool.sol by the tests, so it works without regenerating
 * Command's ABIs. Null, never zeroes, when the pool cannot be read.
 */

export const PAYOUT_DUE_ABI = [
  'function dueWithin(uint256 horizon, uint256 maxClaims) view returns (uint256[] ids, uint256 amount, uint256 short)',
];

/** At most this many claims are listed; `amount` covers only those, as the contract says. */
export const DUE_WITHIN_MAX_CLAIMS = 200;
const DAY = 86_400;

/**
 * Seconds from `now` to the end of the `businessDays`-th business day after today (Mon-Fri, UTC):
 * the rest of today, then that many business days. Two business days from a Wednesday reaches the
 * end of Friday; from a Friday, the end of Tuesday.
 */
export function businessDayHorizon(nowSeconds: number, businessDays = 2): number {
  let end = Math.floor(nowSeconds / DAY) * DAY + DAY; // the end of today, UTC
  let counted = 0;
  while (counted < businessDays) {
    end += DAY;
    const weekday = new Date((end - DAY) * 1000).getUTCDay(); // the day that just ended
    if (weekday !== 0 && weekday !== 6) counted += 1;
  }
  return Math.max(0, end - nowSeconds);
}

export interface PayoutDue {
  /** The horizon asked, in seconds, and the business days it stands for. */
  horizonSeconds: number;
  businessDays: number;
  /** The claims due within it, oldest deadline first is not guaranteed (grouped by window). */
  claimIds: number[];
  /** What those claims add up to, in cents. */
  amountCents: number;
  /** What the pool lacks to pay them on time, in cents: what to fund. */
  shortCents: number;
  /** True when the list hit the cap, so `amountCents` covers only the claims listed. */
  truncated: boolean;
}

const toCentsUp = (units: bigint) => Number((units + 9_999n) / 10_000n);

export async function payoutDueWithin(input: {
  chainId: number;
  nowSeconds?: number;
  businessDays?: number;
  maxClaims?: number;
  /** For tests: the PayoutPool contract, or anything with its `dueWithin`. */
  pool?: { dueWithin: (horizon: bigint, max: bigint) => Promise<[bigint[], bigint, bigint] | ethers.Result> };
}): Promise<PayoutDue | null> {
  const businessDays = input.businessDays ?? 2;
  const max = input.maxClaims ?? DUE_WITHIN_MAX_CLAIMS;
  const horizon = businessDayHorizon(input.nowSeconds ?? Math.floor(Date.now() / 1000), businessDays);
  let pool = input.pool;
  if (!pool) {
    const address = getContractAddress(input.chainId, 'PayoutPool');
    if (!address) return null;
    pool = new ethers.Contract(address, PAYOUT_DUE_ABI, chainProvider(input.chainId)) as unknown as NonNullable<typeof input.pool>;
  }
  try {
    const [ids, amount, short] = (await pool.dueWithin(BigInt(horizon), BigInt(max))) as [bigint[], bigint, bigint];
    // The contract trims the array to the claims it listed (`mstore(ids, n)`).
    const claimIds = Array.from(ids).map(Number);
    return {
      horizonSeconds: horizon,
      businessDays,
      claimIds,
      amountCents: toCentsUp(amount),
      shortCents: toCentsUp(short),
      truncated: claimIds.length >= max,
    };
  } catch (error) {
    console.error('[payout-funding] dueWithin failed', error instanceof Error ? error.message : error);
    return null;
  }
}
