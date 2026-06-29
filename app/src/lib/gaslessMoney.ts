/**
 * Gasless money movement from the wallet's side. The user only SIGNS typed data (no gas); the backend
 * relayer submits the tx. Deposit (Cash→Savings) is one EIP-3009 signature. Redeem (Savings→Cash)
 * needs a one-time CLRUSD approve(vault) (CLRUSD has no permit — decision A3), then one EIP-712 sig.
 * Send locks funds into the escrow via the sender's EIP-3009 signature.
 */
import { getWalletClient, readContract, writeContract, waitForTransactionReceipt, switchChain } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import {
  prepareGaslessSavings,
  submitGaslessSavings,
  prepareSendLockAuthorization,
  submitSendLockAuthorization,
  type Eip712TypedData,
} from '@/utils/apiClient';
import type { SendTransferSummary } from '@/types/send';

const MAX_UINT256 = (2n ** 256n - 1n).toString();

const ERC20_ALLOWANCE_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** Make sure the wallet is on the chain we're transacting on (required before any writeContract). */
async function ensureChain(chainId: number): Promise<void> {
  try {
    await switchChain(wagmiAdapter.wagmiConfig, { chainId });
  } catch {
    /* already on it, or the wallet rejected — signing still binds the chainId, so continue */
  }
}

async function signTypedData(chainId: number, owner: string, typedData: Eip712TypedData): Promise<string> {
  await ensureChain(chainId);
  const walletClient = await getWalletClient(wagmiAdapter.wagmiConfig, { chainId });
  if (!walletClient) throw new Error('Wallet not connected');
  // viem's signTypedData is generic over a static type schema; our typed data is built dynamically by
  // the backend, so we pass the (already-validated) request through its loosely-typed overload.
  return walletClient.signTypedData({
    account: owner as `0x${string}`,
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  } as Parameters<typeof walletClient.signTypedData>[0]);
}

/** Cash (USDC) → Savings (CLRUSD): deposit into the ESA vault, fully gasless. Returns the tx hash. */
export async function gaslessDeposit(args: { ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const prepared = await prepareGaslessSavings({ action: 'deposit', ...args });
  const signature = await signTypedData(prepared.chainId, args.ownerWallet, prepared.typedData);
  const result = await submitGaslessSavings({
    action: 'deposit',
    chainId: prepared.chainId,
    signature,
    submit: prepared.submit,
  });
  return result.txHash;
}

/** Savings (CLRUSD) → Cash (USDC): redeem from the vault. One-time CLRUSD approve, then gasless. */
export async function gaslessRedeem(args: { ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const prepared = await prepareGaslessSavings({ action: 'redeem', ...args });

  if (prepared.approve) {
    await ensureChain(prepared.chainId); // approve is a real (user-paid) tx — wallet must be on-chain
    const needed = BigInt(prepared.amountMicros);
    const allowance = (await readContract(wagmiAdapter.wagmiConfig, {
      address: prepared.approve.token as `0x${string}`,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [args.ownerWallet as `0x${string}`, prepared.approve.spender as `0x${string}`],
      chainId: prepared.chainId,
    })) as bigint;

    if (allowance < needed) {
      const approveHash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: prepared.approve.token as `0x${string}`,
        abi: ERC20_ALLOWANCE_ABI,
        functionName: 'approve',
        args: [prepared.approve.spender as `0x${string}`, BigInt(MAX_UINT256)],
        chainId: prepared.chainId,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash: approveHash, chainId: prepared.chainId });
    }
  }

  const signature = await signTypedData(prepared.chainId, args.ownerWallet, prepared.typedData);
  const result = await submitGaslessSavings({
    action: 'redeem',
    chainId: prepared.chainId,
    signature,
    submit: prepared.submit,
  });
  return result.txHash;
}

/** Gasless Send lock: sign the EIP-3009 authorization for a prepared transfer; relayer locks + issues claim link. */
export async function gaslessSendLock(args: {
  transferRowId: number;
  ownerWallet: string;
}): Promise<{ claimUrl?: string; relayTxHash: string; transfer: SendTransferSummary }> {
  const prepared = await prepareSendLockAuthorization(args.transferRowId);
  const signature = await signTypedData(prepared.chainId, args.ownerWallet, prepared.typedData);
  return submitSendLockAuthorization(args.transferRowId, signature);
}
