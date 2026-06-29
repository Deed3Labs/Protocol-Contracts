import { createPublicClient, encodeFunctionData, http, parseUnits, type Chain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { getWalletClient } from '@wagmi/core';
import { createZeroDevPaymasterClient } from '@zerodev/sdk';
import { getEntryPoint, KERNEL_V3_3 } from '@zerodev/sdk/constants';
import { create7702KernelAccount, create7702KernelAccountClient } from '@zerodev/ecdsa-validator';
import { wagmiAdapter } from '@/AppKitProvider';
import { clearContracts } from '@/lib/clearNetwork';
import { recordGaslessSavings } from '@/utils/apiClient';

/*
 * Account-abstraction layer (ZeroDev Kernel + EIP-7702). The user's EOA is delegated to a Kernel
 * smart account at the SAME address, so we can BATCH (approve + action in one) and SPONSOR (a paymaster
 * pays gas) — no separate approvals, no gas, one signature. AppKit stays the login layer.
 *
 * Activated by VITE_ZERODEV_PROJECT_ID (a ZeroDev project's bundler+paymaster RPC). When unset, callers
 * fall back to the EIP-3009 relayer path (lib/gaslessMoney). UNVERIFIED until a project id + funded
 * paymaster are wired — verify on Base Sepolia first.
 */

const PROJECT_ID = (import.meta.env.VITE_ZERODEV_PROJECT_ID as string | undefined)?.trim();
// Mainnet AA stays OFF until the flow is verified + the mainnet paymaster is funded — then set
// VITE_ZERODEV_MAINNET=true. Testnet (demo) uses AA as soon as a project id is present.
const MAINNET_AA = ((import.meta.env.VITE_ZERODEV_MAINNET as string | undefined) ?? 'false') === 'true';

const CHAINS: Record<number, Chain> = { 8453: base, 84532: baseSepolia };

/** AA active when a project id is set, the chain is supported, and (for mainnet) explicitly enabled. */
export const isAaEnabled = (chainId: number): boolean =>
  !!PROJECT_ID && !!CHAINS[chainId] && (chainId !== 8453 || MAINNET_AA);
// Self-funded sponsorship paymaster (you deposit gas inventory; no managed-paymaster markup).
// Set VITE_ZERODEV_SELF_FUNDED=false to use ZeroDev's managed paymaster directly.
const SELF_FUNDED = ((import.meta.env.VITE_ZERODEV_SELF_FUNDED as string | undefined) ?? 'true') !== 'false';
// ZeroDev v3 RPC serves both bundler + paymaster for a project on a given chain.
const bundlerRpc = (chainId: number) => `https://rpc.zerodev.app/api/v3/${PROJECT_ID}/chain/${chainId}`;
// Self-funded adds ?selfFunded=true; the managed paymaster is the same endpoint without it.
const paymasterRpc = (chainId: number, managed: boolean) =>
  managed ? bundlerRpc(chainId) : `${bundlerRpc(chainId)}?selfFunded=true`;

/** Whether an error looks like a paymaster/sponsorship failure worth retrying on the managed paymaster. */
function isPaymasterError(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    m.includes('paymaster') ||
    m.includes('sponsor') ||
    m.includes('insufficient') ||
    m.includes('not deployed') ||
    m.includes('could not check')
  );
}

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

/** Build a sponsored 7702 Kernel client for the connected wallet, using the chosen paymaster. */
async function kernelClient(chainId: number, managed: boolean) {
  if (!PROJECT_ID) throw new Error('Account abstraction is not configured.');
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`No AA config for chain ${chainId}.`);

  const walletClient = await getWalletClient(wagmiAdapter.wagmiConfig, { chainId });
  if (!walletClient) throw new Error('Wallet not connected');

  const publicClient = createPublicClient({ chain, transport: http() });
  const entryPoint = getEntryPoint('0.7');

  // 7702: delegate the EOA to a Kernel account at the same address; the wallet signs the authorization.
  const account = await create7702KernelAccount(publicClient, {
    signer: walletClient as never,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });

  const paymaster = createZeroDevPaymasterClient({ chain, transport: http(paymasterRpc(chainId, managed)) });
  return create7702KernelAccountClient({
    account,
    chain,
    bundlerTransport: http(bundlerRpc(chainId)),
    paymaster,
    client: publicClient,
  });
}

async function sendWith(
  chainId: number,
  calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[],
  managed: boolean,
): Promise<string> {
  const client = await kernelClient(chainId, managed);
  const hash = await client.sendUserOperation({ calls });
  const receipt = await client.waitForUserOperationReceipt({ hash });
  return receipt.receipt.transactionHash;
}

/**
 * Send a batched, sponsored UserOp and return the settled tx hash. Tries the self-funded paymaster
 * first; if its gas inventory is empty/undeployed, falls back to ZeroDev's managed paymaster so a
 * user is never blocked mid-transaction. (When VITE_ZERODEV_SELF_FUNDED=false we go straight to managed.)
 */
async function sendBatch(chainId: number, calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[]): Promise<string> {
  if (!SELF_FUNDED) return sendWith(chainId, calls, true);
  try {
    return await sendWith(chainId, calls, false);
  } catch (e) {
    if (!isPaymasterError(e)) throw e;
    console.warn('[AA] self-funded paymaster failed; falling back to managed paymaster.', e);
    return sendWith(chainId, calls, true);
  }
}

/** Cash (USDC) → Savings (CLRUSD): [USDC.approve(vault), vault.deposit] in one sponsored op. */
export async function aaDeposit(args: { ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const txHash = await sendBatch(args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.esaVault, amt] }) },
    { to: c.esaVault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'deposit', args: [c.usdc, amt, receiver] }) },
  ]);
  // Equity-credit ledger (best-effort; the AA path bypasses the relayer route that normally records it).
  await recordGaslessSavings({ action: 'deposit', amount: amt.toString(), txHash, chainId: args.chainId }).catch(() => {});
  return txHash;
}

/** Savings (CLRUSD) → Cash (USDC): [CLRUSD.approve(vault), vault.redeem] in one sponsored op. */
export async function aaRedeem(args: { ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const txHash = await sendBatch(args.chainId, [
    { to: c.clrusd, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.esaVault, amt] }) },
    { to: c.esaVault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'redeem', args: [c.usdc, amt, receiver] }) },
  ]);
  await recordGaslessSavings({ action: 'redeem', amount: amt.toString(), txHash, chainId: args.chainId }).catch(() => {});
  return txHash;
}

/**
 * Send: lock USDC in the ClaimEscrow for a prepared transfer in one sponsored op —
 * [USDC.approve(escrow, total), escrow.createTransfer(...)]. The on-chain `TransferCreated` event is
 * verified server-side (confirm-lock with aa:true), which then issues the claim link. The escrow's
 * SETTLER relayer later releases funds to the recipient on claim (the recipient has no account to pull).
 */
export async function aaSendLock(args: {
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
  return sendBatch(args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.claimEscrow, total] }) },
    { to: c.claimEscrow, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'createTransfer', args: [args.transferId, principal, fee, expiry, args.recipientHintHash] }) },
  ]);
}
