import { encodeFunctionData, parseUnits } from 'viem';
import { sendCalls, waitForCallsStatus } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import { clearContracts } from '@/lib/clearNetwork';
import { recordGaslessSavings } from '@/utils/apiClient';

/*
 * 3-TIER gasless money router (see [[clearpath-privy-migration]]).
 *   Tier 1 — email/social: Privy ERC-4337 smart wallet. Pass the client from useSmartWallets(); one
 *            sponsored UserOp, gas paid by the paymaster registered in the Privy dashboard. Silent
 *            (0 signatures). No relayer fallback (a 1271 smart account can't sign EIP-3009).
 *   Tier 2 — external (MetaMask): EIP-5792 wallet_sendCalls + the ZeroDev self-funded paymaster, so the
 *            wallet uses 7702 to batch + sponsor at its own address. Throws if unsupported → caller
 *            falls back to tier 3.
 *   Tier 3 — graceful fallback: the EIP-3009 relayer (handled by the modals' relayerRun), gasless.
 *
 * sc* take `smartWalletClient` (Privy client or undefined). Defined → tier 1; undefined → tier 2.
 */

// Tier-2 sponsorship via the ZeroDev self-funded paymaster (the funded one we verified). Tier-1 needs
// no URL here — Privy applies the dashboard-registered paymaster.
const ZERODEV_PROJECT_ID = (import.meta.env.VITE_ZERODEV_PROJECT_ID as string | undefined)?.trim();
const paymasterUrl = (chainId: number) =>
  `https://rpc.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}/chain/${chainId}?selfFunded=true`;

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

/** Minimal shape of Privy's useSmartWallets().client we use (batched sendTransaction). */
interface SmartWalletLike {
  sendTransaction: (input: { calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] }) => Promise<`0x${string}`>;
}

/** Tier 1: Privy smart wallet — one sponsored UserOp (gas via the dashboard paymaster). */
async function runSmartWallet(client: SmartWalletLike, calls: Call[]): Promise<string> {
  return client.sendTransaction({ calls });
}

/** Tier 2: external wallet via EIP-5792 + ZeroDev paymaster (wallet uses 7702). Throws if unsupported. */
async function run5792(owner: string, chainId: number, calls: Call[]): Promise<string> {
  const config = wagmiAdapter.wagmiConfig;
  const { id } = await sendCalls(config, {
    account: owner as `0x${string}`,
    chainId: chainId as 8453,
    calls,
    ...(ZERODEV_PROJECT_ID ? { capabilities: { paymasterService: { url: paymasterUrl(chainId) } } } : {}),
  });
  const res = await waitForCallsStatus(config, { id, timeout: 120_000 });
  if (res.status !== 'success') {
    throw new Error(`Transaction didn't confirm (status: ${res.status ?? 'unknown'}).`);
  }
  const receipts = res.receipts ?? [];
  const last = receipts[receipts.length - 1];
  if (last && last.status === 'reverted') throw new Error('Transaction reverted on-chain.');
  return (last?.transactionHash as string | undefined) ?? id;
}

/** Route: tier 1 if a Privy smart wallet client is given, else tier 2 (external EIP-5792). */
async function runBatch(smartWalletClient: unknown, owner: string, chainId: number, calls: Call[]): Promise<string> {
  if (smartWalletClient) return runSmartWallet(smartWalletClient as SmartWalletLike, calls);
  return run5792(owner, chainId, calls);
}

/** One-time sponsored ERC-20 approve (smart-account autopay allowance — they can't sign EIP-2612). */
export async function scApprove(args: { smartWalletClient?: unknown; owner: string; token: `0x${string}`; spender: `0x${string}`; amount: bigint; chainId: number }): Promise<string> {
  return runBatch(args.smartWalletClient, args.owner, args.chainId, [
    { to: args.token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [args.spender, args.amount] }) },
  ]);
}

/** Cash (USDC) → Savings (CLRUSD): [approve, deposit] in ONE sponsored batch. */
export async function scDeposit(args: { smartWalletClient?: unknown; ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const hash = await runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.esaVault, amt] }) },
    { to: c.esaVault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'deposit', args: [c.usdc, amt, receiver] }) },
  ]);
  await recordGaslessSavings({ action: 'deposit', amount: amt.toString(), txHash: hash, chainId: args.chainId }).catch(() => {});
  return hash;
}

/** Savings (CLRUSD) → Cash (USDC): [approve, redeem] in ONE sponsored batch. */
export async function scRedeem(args: { smartWalletClient?: unknown; ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const hash = await runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: c.clrusd, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.esaVault, amt] }) },
    { to: c.esaVault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'redeem', args: [c.usdc, amt, receiver] }) },
  ]);
  await recordGaslessSavings({ action: 'redeem', amount: amt.toString(), txHash: hash, chainId: args.chainId }).catch(() => {});
  return hash;
}

/** Send: [approve(escrow), createTransfer] in ONE sponsored batch. Returns the lock tx hash. */
export async function scSendLock(args: {
  smartWalletClient?: unknown;
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
  return runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.claimEscrow, total] }) },
    { to: c.claimEscrow, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'createTransfer', args: [args.transferId, principal, fee, expiry, args.recipientHintHash] }) },
  ]);
}
