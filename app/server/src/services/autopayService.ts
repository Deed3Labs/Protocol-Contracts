import { createPublicClient, encodeFunctionData, http, parseUnits, type Chain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { createKernelAccountClient, createZeroDevPaymasterClient } from '@zerodev/sdk';
import { getEntryPoint, KERNEL_V3_3 } from '@zerodev/sdk/constants';
import { deserializePermissionAccount } from '@zerodev/permissions';
import { savingsGaslessService } from './savingsGaslessService.js';
import { autopayStore, type AutopayRule } from './autopayStore.js';
import { payLedgerStore, networkFromChainId } from './payLedgerStore.js';

/*
 * Autopay executor — runs a due savings-deposit rule using its stored ZeroDev session (permission
 * account). The session was approved once by the user, scoped to USDC.approve + vault.deposit; here
 * we deserialize it, build the kernel client (sponsored paymaster), and send ONE batched UserOp:
 *   [USDC.approve(vault, amt), vault.deposit(usdc, amt, receiver=user)].
 * No user signing — the embedded session key signs, the paymaster pays gas.
 *
 * UNVERIFIED on-chain (7702 + smart-sessions); gated by ZERODEV_PROJECT_ID. A run failure is caught
 * by the runner and retried later, so a bad session can't crash the server.
 */

const PROJECT_ID = (process.env.ZERODEV_PROJECT_ID || '').trim();
const SELF_FUNDED = (process.env.ZERODEV_SELF_FUNDED || 'true').trim() !== 'false';
const CHAINS: Record<number, Chain> = { 8453: base, 84532: baseSepolia };

export function isAutopayExecutorConfigured(): boolean {
  return Boolean(PROJECT_ID);
}

const bundlerRpc = (chainId: number) => `https://rpc.zerodev.app/api/v3/${PROJECT_ID}/chain/${chainId}`;
const paymasterRpc = (chainId: number, managed: boolean) =>
  managed ? bundlerRpc(chainId) : `${bundlerRpc(chainId)}?selfFunded=true`;

function isPaymasterError(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return m.includes('paymaster') || m.includes('sponsor') || m.includes('insufficient') || m.includes('not deployed');
}

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;
const VAULT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

async function sendDepositUserOp(
  chainId: number,
  approval: string,
  receiver: `0x${string}`,
  amountUsdc: number,
  managed: boolean,
): Promise<string> {
  if (!PROJECT_ID) throw new Error('Autopay executor not configured (ZERODEV_PROJECT_ID).');
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`No AA config for chain ${chainId}.`);

  const cfg = savingsGaslessService.resolveConfig(chainId); // vaultAddress, usdcAddress, rpcUrl
  const usdc = cfg.usdcAddress as `0x${string}`;
  const vault = cfg.vaultAddress as `0x${string}`;

  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const entryPoint = getEntryPoint('0.7');
  // The serialized approval embeds the session key (privateKey was passed at serialize time),
  // so no separate signer is needed to reconstruct the session account.
  const account = await deserializePermissionAccount(publicClient, entryPoint, KERNEL_V3_3, approval);

  const paymaster = createZeroDevPaymasterClient({ chain, transport: http(paymasterRpc(chainId, managed)) });
  const kernelClient = createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(bundlerRpc(chainId)),
    paymaster,
    client: publicClient,
  });

  const amt = parseUnits(String(amountUsdc), 6);
  const hash = await kernelClient.sendUserOperation({
    calls: [
      { to: usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [vault, amt] }) },
      { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'deposit', args: [usdc, amt, receiver] }) },
    ],
  });
  const receipt = await kernelClient.waitForUserOperationReceipt({ hash });
  return receipt.receipt.transactionHash;
}

/** Execute one savings-deposit run. Tries self-funded paymaster, falls back to managed. */
export async function runSavingsDeposit(input: {
  chainId: number;
  approval: string;
  wallet: string;
  amountUsdc: number;
}): Promise<string> {
  const receiver = input.wallet as `0x${string}`;
  if (!SELF_FUNDED) return sendDepositUserOp(input.chainId, input.approval, receiver, input.amountUsdc, true);
  try {
    return await sendDepositUserOp(input.chainId, input.approval, receiver, input.amountUsdc, false);
  } catch (e) {
    if (!isPaymasterError(e)) throw e;
    console.warn('[autopay] self-funded paymaster failed; using managed paymaster.', e);
    return sendDepositUserOp(input.chainId, input.approval, receiver, input.amountUsdc, true);
  }
}

/**
 * Run one autopay rule end-to-end: execute the sponsored deposit, advance the schedule on success
 * (or record the error on failure), and award equity credits from the verified on-chain amount.
 * Shared by the scheduler (jobs/autopayRunner) and the "run now" endpoint. Never throws.
 */
export async function executeAutopayRule(
  rule: AutopayRule & { approval: string },
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  try {
    const txHash = await runSavingsDeposit({
      chainId: rule.chainId,
      approval: rule.approval,
      wallet: rule.wallet,
      amountUsdc: rule.amountUsdc,
    });
    await autopayStore.recordSuccess(rule, txHash);

    // Equity-credit match from the verified on-chain deposit amount (best-effort).
    try {
      const amt = await savingsGaslessService.verifySavingsTx({
        chainId: rule.chainId,
        txHash,
        action: 'deposit',
        wallet: rule.wallet,
      });
      if (amt != null) {
        await payLedgerStore.recordDepositMatch({
          wallet: rule.wallet,
          amountMicros: amt,
          txRef: txHash,
          network: networkFromChainId(rule.chainId),
        });
      }
    } catch (error) {
      console.warn('[autopay] credit record failed:', error);
    }
    return { ok: true, txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Autopay run failed';
    await autopayStore.recordFailure(rule, message).catch(() => {});
    return { ok: false, error: message };
  }
}
