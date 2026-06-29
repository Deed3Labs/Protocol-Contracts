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
export const isAaEnabled = (): boolean => !!PROJECT_ID;

const CHAINS: Record<number, Chain> = { 8453: base, 84532: baseSepolia };
// ZeroDev v3 RPC serves both bundler + paymaster for a project on a given chain.
const zerodevRpc = (chainId: number) => `https://rpc.zerodev.app/api/v3/${PROJECT_ID}/chain/${chainId}`;

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;
const VAULT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'redeem', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'clrusdAmount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

/** Build a sponsored 7702 Kernel client for the connected wallet on the given chain. */
async function kernelClient(chainId: number) {
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

  const paymaster = createZeroDevPaymasterClient({ chain, transport: http(zerodevRpc(chainId)) });
  return create7702KernelAccountClient({
    account,
    chain,
    bundlerTransport: http(zerodevRpc(chainId)),
    paymaster,
    client: publicClient,
  });
}

/** Send a batched, sponsored UserOp and return the settled tx hash. */
async function sendBatch(chainId: number, calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[]): Promise<string> {
  const client = await kernelClient(chainId);
  const hash = await client.sendUserOperation({ calls });
  const receipt = await client.waitForUserOperationReceipt({ hash });
  return receipt.receipt.transactionHash;
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
