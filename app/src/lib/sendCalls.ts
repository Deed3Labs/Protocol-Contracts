import { encodeFunctionData, parseUnits } from 'viem';
import { sendCalls, waitForCallsStatus } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import { clearContracts } from '@/lib/clearNetwork';
import { recordGaslessSavings } from '@/utils/apiClient';

// The UserOp is sponsored ONLY when the wallet_sendCalls request carries a paymasterService
// capability (the SA holds no ETH). Reown's OWN paymaster (paymaster-api.reown.com) returns
// "Unauthorized" unless the project is in their invite-only sponsorship beta, so we use ZeroDev's
// SELF-FUNDED paymaster: ZeroDev signs the sponsorship (valid sig) and gas is paid from ETH we
// deposit into the paymaster in the ZeroDev dashboard. URL exactly as shown there:
//   https://rpc.zerodev.app/api/v3/<projectId>/chain/<chainId>?selfFunded=true
const PROJECT_ID = (import.meta.env.VITE_ZERODEV_PROJECT_ID as string | undefined)?.trim();
const paymasterUrl = (chainId: number) =>
  `https://rpc.zerodev.app/api/v3/${PROJECT_ID}/chain/${chainId}?selfFunded=true`;

/*
 * Smart-account (AppKit email/social) money flows, executed via wagmi's `sendCalls` (EIP-5792) — the
 * EXACT path Reown's lab uses (WagmiSendCallsWithPaymasterServiceTest). Reown's embedded smart account
 * wraps the batch as ONE sponsored ERC-4337 UserOp, deploys itself on the first one, and the ZeroDev
 * self-funded paymaster (paymasterService capability) pays gas. approve + action go in ONE batch (one
 * signature). EOAs use EIP-3009 instead.
 *
 * NOTE: raw `wallet_sendCalls` against the embedded provider does NOT honor the paymasterService
 * capability (we saw paymasterAndData: 0x → AA21). wagmi's sendCalls formats it correctly, so the
 * wallet actually calls the paymaster. The sc* args still accept `provider` (now unused) so callers
 * don't have to change.
 */

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;
const VAULT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'redeem', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'clrusdAmount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
const ESCROW_ABI = [
  { name: 'createTransfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'transferId', type: 'bytes32' }, { name: 'principalUsdc', type: 'uint256' }, { name: 'sponsorFeeUsdc', type: 'uint256' }, { name: 'expiry', type: 'uint64' }, { name: 'recipientHintHash', type: 'bytes32' }], outputs: [] },
] as const;

type Call = { to: string; data: string };

/**
 * Execute a sponsored batch via wagmi `sendCalls` (EIP-5792). The embedded smart account bundles the
 * calls into ONE sponsored UserOp, deploys itself on first use, and the paymasterService capability
 * (ZeroDev self-funded) covers gas. Waits for settlement and returns the tx hash.
 */
async function runBatch(owner: string, chainId: number, calls: Call[]): Promise<string> {
  const config = wagmiAdapter.wagmiConfig;
  const { id } = await sendCalls(config, {
    account: owner as `0x${string}`,
    chainId: chainId as 8453,
    calls: calls.map((c) => ({ to: c.to as `0x${string}`, data: c.data as `0x${string}` })),
    ...(PROJECT_ID ? { capabilities: { paymasterService: { url: paymasterUrl(chainId) } } } : {}),
  });
  console.log('[sendCalls] sendCalls id:', id);

  const res = await waitForCallsStatus(config, { id, timeout: 120_000 });
  console.log('[sendCalls] final status:', res.status, JSON.stringify(res.receipts ?? []));
  if (res.status !== 'success') {
    throw new Error(`Transaction didn't confirm (status: ${res.status ?? 'unknown'}).`);
  }
  const receipts = res.receipts ?? [];
  const last = receipts[receipts.length - 1];
  if (last && last.status === 'reverted') throw new Error('Transaction reverted on-chain.');
  return (last?.transactionHash as string | undefined) ?? id;
}

/** One-time sponsored ERC-20 approve (smart-account autopay allowance — they can't sign EIP-2612). */
export async function scApprove(args: { provider: unknown; owner: string; token: `0x${string}`; spender: `0x${string}`; amount: bigint; chainId: number }): Promise<string> {
  return runBatch(args.owner, args.chainId, [
    { to: args.token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [args.spender, args.amount] }) },
  ]);
}

/** Cash (USDC) → Savings (CLRUSD): [approve, deposit] in ONE sponsored batch. */
export async function scDeposit(args: { provider: unknown; ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const hash = await runBatch(args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.esaVault, amt] }) },
    { to: c.esaVault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'deposit', args: [c.usdc, amt, receiver] }) },
  ]);
  await recordGaslessSavings({ action: 'deposit', amount: amt.toString(), txHash: hash, chainId: args.chainId }).catch(() => {});
  return hash;
}

/** Savings (CLRUSD) → Cash (USDC): [approve, redeem] in ONE sponsored batch. */
export async function scRedeem(args: { provider: unknown; ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const hash = await runBatch(args.ownerWallet, args.chainId, [
    { to: c.clrusd, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.esaVault, amt] }) },
    { to: c.esaVault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'redeem', args: [c.usdc, amt, receiver] }) },
  ]);
  await recordGaslessSavings({ action: 'redeem', amount: amt.toString(), txHash: hash, chainId: args.chainId }).catch(() => {});
  return hash;
}

/** Send: [approve(escrow), createTransfer] in ONE sponsored batch. Returns the lock tx hash. */
export async function scSendLock(args: {
  provider: unknown;
  ownerWallet: string;
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
  return runBatch(args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.claimEscrow, total] }) },
    { to: c.claimEscrow, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'createTransfer', args: [args.transferId, principal, fee, expiry, args.recipientHintHash] }) },
  ]);
}
