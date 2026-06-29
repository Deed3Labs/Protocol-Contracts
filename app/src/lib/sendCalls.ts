import { parseUnits } from 'viem';
import { getAccount, readContract, waitForTransactionReceipt, writeContract } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import { clearContracts } from '@/lib/clearNetwork';
import { recordGaslessSavings } from '@/utils/apiClient';

/*
 * Smart-account (AppKit email/social) money flows. These run as plain wagmi writeContract calls —
 * Reown's embedded smart account automatically wraps each one as a sponsored ERC-4337 UserOp, DEPLOYS
 * the account on the first one, and pays gas via its paymaster. (The EIP-5792 `wallet_sendCalls` path
 * was unreliable for counterfactual accounts — the op was signed but never mined.) Each action needs a
 * one-time MAX approve (its own sponsored tx) since approve+action can't be guaranteed atomic.
 * EOAs do NOT use this path — they use the EIP-3009 relayer (lib/gaslessMoney), which is gasless too.
 */

const config = wagmiAdapter.wagmiConfig;
const MAX_UINT256 = (1n << 256n) - 1n;

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
const VAULT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'redeem', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'clrusdAmount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
const ESCROW_ABI = [
  { name: 'createTransfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'transferId', type: 'bytes32' }, { name: 'principalUsdc', type: 'uint256' }, { name: 'sponsorFeeUsdc', type: 'uint256' }, { name: 'expiry', type: 'uint64' }, { name: 'recipientHintHash', type: 'bytes32' }], outputs: [] },
] as const;

/** Submit one writeContract tx (Reown wraps + sponsors + deploys the SA) and wait for it to mine. */
async function sendTx(chainId: number, params: Parameters<typeof writeContract>[1]): Promise<`0x${string}`> {
  const hash = await writeContract(config, params);
  await waitForTransactionReceipt(config, { hash, chainId });
  return hash;
}

/** Ensure a standing MAX allowance exists (one-time, sponsored). The first call also deploys the SA. */
async function ensureAllowance(chainId: number, token: `0x${string}`, spender: `0x${string}`, needed: bigint): Promise<void> {
  const owner = getAccount(config).address;
  if (!owner) throw new Error('Wallet not connected.');
  const current = (await readContract(config, {
    abi: ERC20_ABI,
    address: token,
    functionName: 'allowance',
    args: [owner, spender],
    chainId,
  })) as bigint;
  if (current >= needed) return;
  await sendTx(chainId, { abi: ERC20_ABI, address: token, functionName: 'approve', args: [spender, MAX_UINT256], chainId });
}

/** One-time sponsored ERC-20 approve (smart-account autopay allowance — they can't sign EIP-2612). */
export async function scApprove(args: { token: `0x${string}`; spender: `0x${string}`; amount: bigint; chainId: number }): Promise<string> {
  return sendTx(args.chainId, { abi: ERC20_ABI, address: args.token, functionName: 'approve', args: [args.spender, args.amount], chainId: args.chainId });
}

/** Cash (USDC) → Savings (CLRUSD): one-time approve (sponsored), then a sponsored deposit. */
export async function scDeposit(args: { ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  await ensureAllowance(args.chainId, c.usdc, c.esaVault, amt);
  const hash = await sendTx(args.chainId, { abi: VAULT_ABI, address: c.esaVault, functionName: 'deposit', args: [c.usdc, amt, receiver], chainId: args.chainId });
  await recordGaslessSavings({ action: 'deposit', amount: amt.toString(), txHash: hash, chainId: args.chainId }).catch(() => {});
  return hash;
}

/** Savings (CLRUSD) → Cash (USDC): one-time approve (sponsored), then a sponsored redeem. */
export async function scRedeem(args: { ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  await ensureAllowance(args.chainId, c.clrusd, c.esaVault, amt);
  const hash = await sendTx(args.chainId, { abi: VAULT_ABI, address: c.esaVault, functionName: 'redeem', args: [c.usdc, amt, receiver], chainId: args.chainId });
  await recordGaslessSavings({ action: 'redeem', amount: amt.toString(), txHash: hash, chainId: args.chainId }).catch(() => {});
  return hash;
}

/** Send: lock USDC in the ClaimEscrow for a prepared transfer (one-time approve, then createTransfer). */
export async function scSendLock(args: {
  chainId: number;
  transferId: `0x${string}`;
  principalUsdcMicros: string;
  sponsorFeeUsdcMicros: string;
  totalLockedUsdcMicros: string;
  recipientHintHash: `0x${string}`;
  expiresAt: string;
}): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const principal = BigInt(args.principalUsdcMicros);
  const fee = BigInt(args.sponsorFeeUsdcMicros);
  const total = BigInt(args.totalLockedUsdcMicros);
  const expiry = BigInt(Math.floor(new Date(args.expiresAt).getTime() / 1000));
  await ensureAllowance(args.chainId, c.usdc, c.claimEscrow, total);
  return sendTx(args.chainId, {
    abi: ESCROW_ABI,
    address: c.claimEscrow,
    functionName: 'createTransfer',
    args: [args.transferId, principal, fee, expiry, args.recipientHintHash],
    chainId: args.chainId,
  });
}
