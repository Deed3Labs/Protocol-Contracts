import { encodeFunctionData, parseUnits } from 'viem';
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
 * Smart-account (AppKit email/social) money flows, executed through the RAW AppKit walletProvider via
 * EIP5792Utils — Reown's embedded smart account wraps the batch as ONE sponsored ERC-4337 UserOp,
 * deploys itself on the first one, and pays gas. We use the raw provider (not wagmi sendCalls/
 * writeContract) because those mishandled the embedded provider's CAIP chain id / never mined the op.
 * approve + action go in ONE atomic batch (bundled, single signature). EOAs use EIP-3009 instead.
 *
 * `provider` is the object from useAppKitProvider('eip155') — callers pass it in (hooks can't run here).
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
interface Eip1193 { request: (args: { method: string; params?: unknown[] }) => Promise<any> }

/**
 * Execute a sponsored batch via the embedded smart account's raw wallet_sendCalls. We use
 * `atomicRequired: false` because Reown's embedded wallet doesn't advertise ATOMIC batching — but it
 * still runs the calls IN ORDER in one sponsored UserOp (approve before action), which is all we need.
 * Polls wallet_getCallsStatus and returns the settled tx hash.
 */
async function runBatch(providerLike: unknown, owner: string, chainId: number, calls: Call[]): Promise<string> {
  const provider = providerLike as Eip1193 | undefined;
  if (!provider?.request) throw new Error('Wallet provider unavailable — reconnect your wallet.');

  const params: Record<string, unknown> = {
    version: '2.0.0',
    from: owner,
    chainId: `0x${chainId.toString(16)}`,
    atomicRequired: false,
    calls,
  };
  // The paymasterService capability is what makes Reown sponsor gas (the SA holds no ETH).
  if (PROJECT_ID) params.capabilities = { paymasterService: { url: paymasterUrl(chainId) } };

  const response = await provider.request({ method: 'wallet_sendCalls', params: [params] });
  console.log('[sendCalls] wallet_sendCalls response:', response);
  const batchId: string = typeof response === 'string' ? response : response?.batchId ?? response?.id;
  if (!batchId) throw new Error(`Wallet did not return a batch id (got: ${JSON.stringify(response)}).`);

  let lastStatus: unknown;
  for (let i = 0; i < 45; i++) {
    let status: { status?: number | string; receipts?: { transactionHash?: string; status?: string | number }[] } | undefined;
    try {
      status = await provider.request({ method: 'wallet_getCallsStatus', params: [batchId] });
      lastStatus = status;
      console.log('[sendCalls] getCallsStatus:', JSON.stringify(status));
    } catch (e) {
      console.warn('[sendCalls] getCallsStatus not ready:', (e as Error)?.message);
    }
    const s = status?.status;
    if (s === 200 || s === 'CONFIRMED' || s === 'success') {
      const receipts = status?.receipts ?? [];
      const r = receipts[receipts.length - 1];
      if (r && (r.status === '0x0' || r.status === 0)) throw new Error('Transaction reverted on-chain.');
      return r?.transactionHash ?? batchId;
    }
    if (s === 400 || s === 500 || s === 'FAILED' || s === 'reverted') {
      throw new Error(`Transaction failed (status ${s}): ${JSON.stringify(status)}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Transaction didn't confirm in time. Last status: ${JSON.stringify(lastStatus)}`);
}

/** One-time sponsored ERC-20 approve (smart-account autopay allowance — they can't sign EIP-2612). */
export async function scApprove(args: { provider: unknown; owner: string; token: `0x${string}`; spender: `0x${string}`; amount: bigint; chainId: number }): Promise<string> {
  return runBatch(args.provider, args.owner, args.chainId, [
    { to: args.token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [args.spender, args.amount] }) },
  ]);
}

/** Cash (USDC) → Savings (CLRUSD): [approve, deposit] in ONE sponsored batch. */
export async function scDeposit(args: { provider: unknown; ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const hash = await runBatch(args.provider, args.ownerWallet, args.chainId, [
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
  const hash = await runBatch(args.provider, args.ownerWallet, args.chainId, [
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
  return runBatch(args.provider, args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.claimEscrow, total] }) },
    { to: c.claimEscrow, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'createTransfer', args: [args.transferId, principal, fee, expiry, args.recipientHintHash] }) },
  ]);
}
