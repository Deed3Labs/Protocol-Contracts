import { encodeFunctionData, parseUnits } from 'viem';
import { getCapabilities, sendCalls, waitForCallsStatus } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import { clearContracts } from '@/lib/clearNetwork';
import { recordGaslessSavings } from '@/utils/apiClient';

/*
 * Unified AA via EIP-5792 (`wallet_sendCalls`) + an ERC-7677 paymaster. This is the wallet-NATIVE
 * account-abstraction path that works for BOTH wallet types — MetaMask (EOA; the wallet upgrades via
 * 7702 under the hood) and AppKit email/social (already a 4337 smart account). The wallet batches the
 * calls (approve + action in one) and a paymaster sponsors gas → one signature, no separate approval,
 * gasless, SAME address. Replaces the ZeroDev 7702 path, which couldn't sign on viem ≥2.44 (the version
 * AppKit forces). When a wallet doesn't support batching+sponsorship, callers fall back to EIP-3009.
 */

const PROJECT_ID = (import.meta.env.VITE_ZERODEV_PROJECT_ID as string | undefined)?.trim();
const SELF_FUNDED = ((import.meta.env.VITE_ZERODEV_SELF_FUNDED as string | undefined) ?? 'true') !== 'false';
// ERC-7677 paymaster service URL the wallet calls to sponsor the bundle (ZeroDev v3).
const paymasterUrl = (chainId: number) => {
  const base = `https://rpc.zerodev.app/api/v3/${PROJECT_ID}/chain/${chainId}`;
  return SELF_FUNDED ? `${base}?selfFunded=true` : base;
};

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

type Call = { to: `0x${string}`; data: `0x${string}` };

/**
 * Whether the connected wallet can do gasless batched calls on this chain — it must support BOTH
 * atomic batching AND a paymaster service (so the user signs once and pays no gas). If not, callers
 * use the EIP-3009 relayer (also gasless) instead. Best-effort: any failure → treated as unsupported.
 */
export async function canUseSendCalls(chainId: number): Promise<boolean> {
  if (!PROJECT_ID) return false;
  try {
    const caps = await getCapabilities(wagmiAdapter.wagmiConfig, { chainId });
    const atomic = caps?.atomic?.status === 'supported' || caps?.atomic?.status === 'ready';
    const paymaster = Boolean(caps?.paymasterService?.supported);
    return atomic && paymaster;
  } catch {
    return false;
  }
}

/** Send a sponsored batch and return the settled tx hash. */
async function runCalls(chainId: number, calls: Call[]): Promise<string> {
  if (!PROJECT_ID) throw new Error('Sponsorship is not configured.');
  const { id } = await sendCalls(wagmiAdapter.wagmiConfig, {
    chainId,
    calls,
    capabilities: { paymasterService: { url: paymasterUrl(chainId) } },
  });
  const result = await waitForCallsStatus(wagmiAdapter.wagmiConfig, { id });
  if (result.status !== 'success') throw new Error('The batched transaction did not complete.');
  const hash = result.receipts?.[result.receipts.length - 1]?.transactionHash;
  if (!hash) throw new Error('No transaction hash returned from the batch.');
  return hash;
}

/** Cash (USDC) → Savings (CLRUSD): [approve, deposit] in one sponsored batch. */
export async function scDeposit(args: { ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const txHash = await runCalls(args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.esaVault, amt] }) },
    { to: c.esaVault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'deposit', args: [c.usdc, amt, receiver] }) },
  ]);
  await recordGaslessSavings({ action: 'deposit', amount: amt.toString(), txHash, chainId: args.chainId }).catch(() => {});
  return txHash;
}

/** Savings (CLRUSD) → Cash (USDC): [approve, redeem] in one sponsored batch. */
export async function scRedeem(args: { ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const txHash = await runCalls(args.chainId, [
    { to: c.clrusd, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.esaVault, amt] }) },
    { to: c.esaVault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'redeem', args: [c.usdc, amt, receiver] }) },
  ]);
  await recordGaslessSavings({ action: 'redeem', amount: amt.toString(), txHash, chainId: args.chainId }).catch(() => {});
  return txHash;
}

/** Send: lock USDC in the ClaimEscrow for a prepared transfer in one sponsored batch. Returns the tx hash. */
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
  return runCalls(args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.claimEscrow, total] }) },
    { to: c.claimEscrow, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'createTransfer', args: [args.transferId, principal, fee, expiry, args.recipientHintHash] }) },
  ]);
}
