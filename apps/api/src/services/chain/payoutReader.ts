import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { chainId } from '../chargeService.js';
import { chainProvider } from './provider.js';
import { coalesce } from './readCache.js';

/*
 * What the payout pool can do for one merchant, today.
 *
 * `profileStore.payoutPosition` carried `availableTodayCents = null` with a note saying the credit
 * side answers this and nothing off-chain should guess a cap it cannot verify. This is that answer.
 *
 * Three figures, and the distinction between them is the whole point:
 *
 *   redeemable    the merchant's positive balance on the ledger. What the co-op owes them, netted
 *                 against any credit of their own, because the ledger keeps one signed number.
 *   freeNow       what redeeming would turn into money TODAY rather than into a queued claim.
 *   window        how long the co-op has if it queues. Net-30 unless their agreement says less.
 *
 * `freeNow` follows the pool's own rule rather than restating it. `redeem` pays on the spot only
 * when the new claim is the one at the front -- that is, when nothing is queued ahead of it -- and
 * `payQueue` then pays in age order while the cash lasts. So what is free today is the cash on
 * hand, less money already promised to members owed a refund, less everything queued ahead. A
 * merchant asking for more than that is not refused; they are told it queues.
 *
 * Null, never zero, when the chain cannot be read: a shop owed money and shown $0.00 available
 * would act on it.
 */

const POOL_ABI = [
  'function held() view returns (uint256)',
  'function queuedTotal() view returns (uint256)',
  'function refundsOwed() view returns (uint256)',
  'function redeemableOf(address merchant) view returns (uint256)',
];

const REGISTRY_ABI = ['function payoutWindowOf(address merchant) view returns (uint32)'];

export interface MerchantPayoutPosition {
  /** The merchant's positive ledger balance, in USDC micros. */
  redeemableMicros: bigint;
  /** How much of it would be paid immediately rather than queued, in micros. */
  freeNowMicros: bigint;
  /** What the pool holds, in micros, for saying why the rest has to wait. */
  heldMicros: bigint;
  /** Claims already in front of them, in micros. */
  queuedAheadMicros: bigint;
  /** Their agreed payout window in seconds, which is what queuing costs them. */
  windowSeconds: number;
}

export async function merchantPayoutPosition(
  merchant: string,
): Promise<MerchantPayoutPosition | null> {
  if (!ethers.isAddress(merchant)) return null;
  const chain = chainId();
  const poolAddress = getContractAddress(chain, 'PayoutPool');
  if (!poolAddress) return null;

  return coalesce(`payout:${chain}:${merchant.toLowerCase()}`, async () => {
    try {
      const provider = chainProvider(chain);
      const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
      const registryAddress = getContractAddress(chain, 'MerchantRegistry');

      const [held, queued, refundsOwed, redeemable] = (await Promise.all([
        pool.held(),
        pool.queuedTotal(),
        pool.refundsOwed(),
        pool.redeemableOf(merchant),
      ])) as [bigint, bigint, bigint, bigint];

      let windowSeconds = 30 * 24 * 60 * 60;
      if (registryAddress) {
        const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);
        windowSeconds = Number(await registry.payoutWindowOf(merchant));
      }

      return {
        redeemableMicros: redeemable,
        freeNowMicros: freeNow({ held, queued, refundsOwed, redeemable }),
        heldMicros: held,
        queuedAheadMicros: queued,
        windowSeconds,
      };
    } catch (error) {
      console.error(
        '[merchant] could not read the payout position',
        error instanceof Error ? error.message : 'unknown error',
      );
      return null;
    }
  });
}

/**
 * What redeeming would turn into money today rather than into a queued claim.
 *
 * Its own function because it is the rule, not a calculation: cash on hand, less what is already
 * promised to members owed a refund (which the pool pays before any claim), less everything queued
 * ahead (which the pool pays in age order, always), and never more than the merchant is owed.
 */
export function freeNow(input: {
  held: bigint;
  queued: bigint;
  refundsOwed: bigint;
  redeemable: bigint;
}): bigint {
  const spokenFor = input.refundsOwed + input.queued;
  const spare = input.held > spokenFor ? input.held - spokenFor : 0n;
  return spare < input.redeemable ? spare : input.redeemable;
}

/** USDC micros to whole cents, truncated: never show a cent that cannot be withdrawn. */
export function microsToCents(micros: bigint): number {
  return Number(micros / 10_000n);
}
