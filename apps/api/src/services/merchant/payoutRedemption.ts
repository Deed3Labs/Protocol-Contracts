import { encodeFunctionData, parseEventLogs, type Address } from 'viem';
import { getContractAddress } from '../../config/contracts.js';
import { chainId } from '../chargeService.js';
import { shopWallet, shopWalletGap } from './shopWallet.js';

/*
 * Turning what a shop is owed into money, without the shop paying for gas.
 *
 * A merchant's positive balance on the ledger IS the payables ledger; `PayoutPool.redeem` is where
 * it becomes USDC in their own account. Nothing anywhere called it until this existed: the withdraw
 * route recorded a request and said so honestly, and the pool's address appeared in the server's
 * config and nowhere else. A merchant could be paid and could not collect.
 *
 * **Privy sponsors the gas.** `sponsor: true` on the wallet's own RPC — no paymaster of ours, no
 * bundler, no EIP-7702 delegation, no smart account at another address. This file previously built
 * all of that on ZeroDev before anybody read Privy's own docs, and it was a great deal of machinery
 * for a boolean. What remains is: Clear is an authorized signer on the shop's wallet, so Clear can
 * send from it, and Privy pays.
 *
 * Two transactions rather than a batch, deliberately. `wallet_sendCalls` would do both at once, but
 * the policy that bounds Clear's signer names `eth_sendTransaction` — a batch would be a method the
 * ceiling does not cover, and widening a policy to save one sponsored transaction is a bad trade.
 *
 *   ClearCredit.approve(pool, amount)   only when the allowance is short. The pool pulls the
 *                                       credits with transferFrom, and a first-ever redemption
 *                                       would otherwise fail on a wallet that has never approved.
 *   PayoutPool.redeem(amount)           pays now if the pool is funded, queues at the merchant's
 *                                       agreed window if it is not. Both are the thing working.
 *
 * Unconfigured is reported, never faked. A server without sponsorship or without Clear's signing
 * key says so, and the caller records a request the old way rather than claiming money moved.
 */


const CREDIT_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const POOL_ABI = [
  {
    name: 'redeem',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [
      { name: 'paidNow', type: 'bool' },
      { name: 'claimId', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Redeemed',
    inputs: [
      { name: 'merchant', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'paidNow', type: 'bool', indexed: false },
      { name: 'claimId', type: 'uint256', indexed: false },
    ],
  },
] as const;

export type RedemptionResult =
  | {
      ok: true;
      txHash: string;
      /** Paid into the shop's own account now, rather than queued. */
      paidNow: boolean;
      claimId: string | null;
      amountMicros: string;
    }
  | { ok: false; reason: string };

/** Whether a redemption can be attempted at all on this server. */
export function redemptionConfigured(): boolean {
  return redemptionGap() === null;
}

/** Why it cannot be, in the words a shop should be told. */
export function redemptionGap(): string | null {
  const walletGap = shopWalletGap();
  if (walletGap) return walletGap;
  if (!getContractAddress(chainId(), 'PayoutPool')) return 'No payout pool on this chain.';
  if (!getContractAddress(chainId(), 'ClearCredit')) return 'No credit ledger on this chain.';
  return null;
}

/**
 * Redeem for a merchant, with Privy paying the gas.
 *
 * `amountMicros` is capped at what the merchant actually holds rather than refused, because a
 * balance can move between a screen being drawn and a button being pressed, and the honest answer
 * to "send me everything" is everything there is. Zero is refused: an empty transaction still costs
 * somebody gas, even when that somebody is us.
 */
export async function redeemForMerchant(input: {
  merchant: string;
  amountMicros: bigint;
}): Promise<RedemptionResult> {
  const gap = redemptionGap();
  if (gap) return { ok: false, reason: gap };

  const poolAddress = getContractAddress(chainId(), 'PayoutPool') as Address;
  const creditAddress = getContractAddress(chainId(), 'ClearCredit') as Address;

  const wallet = await shopWallet(input.merchant);
  if ('error' in wallet) return { ok: false, reason: wallet.error };
  const { publicClient, send } = wallet;
  const merchant = wallet.address;

  const [held, allowance] = await Promise.all([
    publicClient.readContract({ address: creditAddress, abi: CREDIT_ABI, functionName: 'balanceOf', args: [merchant] }),
    publicClient.readContract({
      address: creditAddress,
      abi: CREDIT_ABI,
      functionName: 'allowance',
      args: [merchant, poolAddress],
    }),
  ]);

  const amount = input.amountMicros < held ? input.amountMicros : held;
  if (amount <= 0n) return { ok: false, reason: 'There is nothing to withdraw from what you are owed.' };

  try {
    if (allowance < amount) {
      const approveHash = await send(
        creditAddress,
        encodeFunctionData({ abi: CREDIT_ABI, functionName: 'approve', args: [poolAddress, amount] }),
      );
      // Waited for, not fired and forgotten: the redemption that follows depends on this allowance
      // existing, and a pending approve would make it revert for a reason nobody could see.
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const redeemHash = await send(
      poolAddress,
      encodeFunctionData({ abi: POOL_ABI, functionName: 'redeem', args: [amount] }),
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash: redeemHash });
    const [redeemed] = parseEventLogs({ abi: POOL_ABI, eventName: 'Redeemed', logs: receipt.logs });

    return {
      ok: true,
      txHash: receipt.transactionHash,
      paidNow: Boolean(redeemed?.args?.paidNow),
      claimId: redeemed?.args?.claimId === undefined ? null : String(redeemed.args.claimId),
      amountMicros: amount.toString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[merchant] redemption failed', message);
    // Never the raw chain error: a shop reads this. What it must not say is that money moved.
    return { ok: false, reason: 'We could not move that just now. Nothing has left your balance.' };
  }
}
