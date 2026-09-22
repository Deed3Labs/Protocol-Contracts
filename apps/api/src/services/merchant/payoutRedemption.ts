import { createPublicClient, encodeFunctionData, http, parseEventLogs, type Address, type Chain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { createZeroDevPaymasterClient } from '@zerodev/sdk';
import { getEntryPoint, KERNEL_V3_3 } from '@zerodev/sdk/constants';
import { create7702KernelAccount, create7702KernelAccountClient } from '@zerodev/ecdsa-validator';
import { getContractAddress } from '../../config/contracts.js';
import { chainId } from '../chargeService.js';
import { merchantOrgFor } from './privyOrg.js';
import { orgWalletAccount, orgWalletSigningConfigured, orgWalletSigningGap } from './orgWalletAccount.js';

/*
 * Turning what a shop is owed into money, without the shop paying for gas.
 *
 * A merchant's positive balance on the ledger IS the payables ledger; `PayoutPool.redeem` is where
 * it becomes USDC in their own account. Until this existed, nothing anywhere called it: the
 * withdraw route recorded a request and said so honestly, and the pool's address appeared in the
 * server's config and nowhere else. A merchant could be paid and could not collect.
 *
 * Two calls, one sponsored operation:
 *
 *   ClearCredit.approve(pool, amount)   the pool pulls the credits with transferFrom, so it needs
 *                                       an allowance -- and a first-ever redemption would
 *                                       otherwise need its own transaction, with its own gas, from
 *                                       a wallet holding no ETH. Batching is exactly why the
 *                                       member app reaches for account abstraction too.
 *   PayoutPool.redeem(amount)           pays now if the pool is funded, queues at the merchant's
 *                                       agreed window if it is not. Both are success.
 *
 * **The merchant address never changes.** 7702 delegates the org wallet to a Kernel account at the
 * same address, so the registry entry, the credits, the claim and the cash account all stay where
 * they are. A separate smart wallet would be a new address and would need every one of those moved.
 *
 * Unconfigured is reported, never faked. A server without a ZeroDev project or Clear's signing key
 * says so, and the caller records a request the old way rather than claiming money moved.
 */

const PROJECT_ID = (process.env.ZERODEV_PROJECT_ID || '').trim();
const SELF_FUNDED = (process.env.ZERODEV_SELF_FUNDED ?? 'true') !== 'false';

const CHAINS: Record<number, Chain> = { 8453: base, 84532: baseSepolia };

const bundlerRpc = (chain: number) => `https://rpc.zerodev.app/api/v3/${PROJECT_ID}/chain/${chain}`;
const paymasterRpc = (chain: number, managed: boolean) =>
  managed ? bundlerRpc(chain) : `${bundlerRpc(chain)}?selfFunded=true`;

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
  return (
    orgWalletSigningConfigured() && PROJECT_ID.length > 0 && !!CHAINS[chainId()] && !!getContractAddress(chainId(), 'PayoutPool')
  );
}

/** Why it cannot be, in the words a shop should be told. */
export function redemptionGap(): string | null {
  const signing = orgWalletSigningGap();
  if (signing) return signing;
  if (!PROJECT_ID) return 'Gas sponsorship is not configured on this server.';
  if (!CHAINS[chainId()]) return `No sponsorship configuration for chain ${chainId()}.`;
  if (!getContractAddress(chainId(), 'PayoutPool')) return 'No payout pool on this chain.';
  return null;
}

/**
 * Redeem for a merchant, sponsored.
 *
 * `amountMicros` is capped at what the merchant actually holds rather than refused, because a
 * balance can move between a screen being drawn and a button being pressed, and the honest answer
 * to "send me everything" is everything there is. Zero is refused: an empty operation still costs
 * somebody gas.
 */
export async function redeemForMerchant(input: {
  merchant: string;
  amountMicros: bigint;
}): Promise<RedemptionResult> {
  const gap = redemptionGap();
  if (gap) return { ok: false, reason: gap };

  const chain = CHAINS[chainId()]!;
  const poolAddress = getContractAddress(chainId(), 'PayoutPool') as Address;
  const creditAddress = getContractAddress(chainId(), 'ClearCredit') as Address | null;
  if (!creditAddress) return { ok: false, reason: 'No credit ledger on this chain.' };

  const org = await merchantOrgFor(input.merchant);
  if (!org) return { ok: false, reason: 'This shop has no wallet on file.' };

  const publicClient = createPublicClient({ chain, transport: http() });
  const merchant = org.walletAddress as Address;

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

  const calls: { to: Address; data: `0x${string}` }[] = [];
  if (allowance < amount) {
    calls.push({
      to: creditAddress,
      data: encodeFunctionData({ abi: CREDIT_ABI, functionName: 'approve', args: [poolAddress, amount] }),
    });
  }
  calls.push({ to: poolAddress, data: encodeFunctionData({ abi: POOL_ABI, functionName: 'redeem', args: [amount] }) });

  try {
    const receipt = await send(chain, { walletId: org.walletId, address: merchant }, calls);
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

/** Sponsored send, self-funded paymaster first and the managed one if its inventory is empty. */
async function send(
  chain: Chain,
  wallet: { walletId: string; address: string },
  calls: { to: Address; data: `0x${string}` }[],
) {
  if (!SELF_FUNDED) return sendWith(chain, wallet, calls, true);
  try {
    return await sendWith(chain, wallet, calls, false);
  } catch (error) {
    if (!isPaymasterError(error)) throw error;
    console.warn('[merchant] self-funded paymaster failed; falling back to the managed one.');
    return sendWith(chain, wallet, calls, true);
  }
}

async function sendWith(
  chain: Chain,
  wallet: { walletId: string; address: string },
  calls: { to: Address; data: `0x${string}` }[],
  managed: boolean,
) {
  const publicClient = createPublicClient({ chain, transport: http() });
  const entryPoint = getEntryPoint('0.7');
  const account = await create7702KernelAccount(publicClient, {
    signer: orgWalletAccount(wallet) as never,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });
  const paymaster = createZeroDevPaymasterClient({
    chain,
    transport: http(paymasterRpc(chain.id, managed)),
  });
  const client = create7702KernelAccountClient({
    account,
    chain,
    bundlerTransport: http(bundlerRpc(chain.id)),
    paymaster,
    client: publicClient,
  });

  const hash = await client.sendUserOperation({ calls });
  const { receipt } = await client.waitForUserOperationReceipt({ hash });
  return receipt;
}

/** A sponsorship failure worth retrying elsewhere, as opposed to a refusal by the chain. */
function isPaymasterError(error: unknown): boolean {
  const m = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    m.includes('paymaster') ||
    m.includes('sponsor') ||
    m.includes('insufficient') ||
    m.includes('not deployed') ||
    m.includes('could not check')
  );
}
