import { PrivyClient } from '@privy-io/node';
import { createPublicClient, encodeFunctionData, http, parseEventLogs, type Address, type Chain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { getContractAddress } from '../../config/contracts.js';
import { chainId } from '../chargeService.js';
import { merchantOrgFor } from './privyOrg.js';

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

const APP_ID = (process.env.PRIVY_APP_ID || '').trim();
const APP_SECRET = (process.env.PRIVY_APP_SECRET || '').trim();
const AUTHORIZATION_PRIVATE_KEY = (process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY || '').trim();

const CHAINS: Record<number, Chain> = { 8453: base, 84532: baseSepolia };

let client: PrivyClient | null = null;
function privy(): PrivyClient | null {
  if (!APP_ID || !APP_SECRET) return null;
  if (!client) client = new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET });
  return client;
}

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
  if (!privy()) return 'Privy is not configured on this server.';
  if (!AUTHORIZATION_PRIVATE_KEY) return "Clear's signing key is not configured on this server.";
  if (!CHAINS[chainId()]) return `No chain configuration for ${chainId()}.`;
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

  const p = privy()!;
  const chain = CHAINS[chainId()]!;
  const poolAddress = getContractAddress(chainId(), 'PayoutPool') as Address;
  const creditAddress = getContractAddress(chainId(), 'ClearCredit') as Address;

  const org = await merchantOrgFor(input.merchant);
  if (!org) return { ok: false, reason: 'This shop has no wallet on file.' };

  // By address, not by the id we stored: a stale `privy_wallet_id` is a 404 that would read as a
  // shop with no wallet at all.
  const wallet = await p
    .wallets()
    .getWalletByAddress({ address: org.walletAddress })
    .catch(() => null);
  if (!wallet) return { ok: false, reason: 'Privy has no wallet at this shop’s address.' };

  const publicClient = createPublicClient({ chain, transport: http() });
  const merchant = wallet.address as Address;

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

  const caip2 = `eip155:${chain.id}` as const;

  /*
   * A sponsored send is a user operation, not a transaction, and it comes back saying so:
   *
   *   { hash: "", user_operation_hash: "0x…", sponsorship_provider: "alchemy", transaction_id: "…" }
   *
   * There is no transaction hash yet because a bundler has not yet included it. So this follows
   * the `transaction_id` until Privy reports one, rather than reading `hash` and finding an empty
   * string — which an earlier version of this did, and would have failed on every sponsored send
   * while looking like a chain problem.
   *
   * What the receipt shows afterwards is worth recording: the wallet is EIP-7702 delegated by
   * Privy, and the user operation's sender is the merchant's own address. So `redeem` sees the
   * merchant as msg.sender, which is the entire reason this address can be the shop everywhere.
   */
  const settle = async (transactionId: string): Promise<`0x${string}`> => {
    for (let i = 0; i < 40; i++) {
      const tx = await p.transactions().get(transactionId);
      if (tx.transaction_hash) return tx.transaction_hash as `0x${string}`;
      if (tx.status === 'failed' || tx.status === 'execution_reverted' || tx.status === 'provider_error') {
        throw new Error(`Privy reported the transaction ${tx.status}.`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error('The transaction was accepted but has not been included yet.');
  };

  const send = async (to: Address, data: `0x${string}`) => {
    const result = (await p.wallets().ethereum().sendTransaction(wallet.id, {
      caip2,
      params: { transaction: { to, data, chain_id: chain.id } },
      // The whole of the gasless story. Privy's own sponsorship, configured in their dashboard,
      // rather than a paymaster of ours to keep funded.
      sponsor: true,
      authorization_context: { authorization_private_keys: [AUTHORIZATION_PRIVATE_KEY] },
    } as never)) as { hash?: string; transaction_id?: string };
    if (result.hash) return result.hash as `0x${string}`;
    if (!result.transaction_id) throw new Error('Privy returned neither a hash nor a transaction to follow.');
    return settle(result.transaction_id);
  };

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
