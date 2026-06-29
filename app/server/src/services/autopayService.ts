import { ethers } from 'ethers';
import { savingsGaslessService } from './savingsGaslessService.js';
import { savingsRelayerService } from './savingsRelayerService.js';
import { autopayStore, type AutopayRule } from './autopayStore.js';
import { payLedgerStore, networkFromChainId } from './payLedgerStore.js';

/*
 * Autopay executor — runs one recurring-deposit mandate. The depositor signed an EIP-712 DepositMandate
 * once (+ a one-time USDC permit for the allowance); here the OPERATOR relayer calls the vault's
 * executeMandateDeposit, which pulls USDC and mints CLRUSD. No user signing, gas paid by the relayer.
 * The on-chain mandate state enforces cadence/run-count/expiry; this just submits when due.
 */

export interface DepositMandate {
  depositor: string;
  token: string; // USDC
  amountPerRun: string; // micros
  interval: number; // seconds
  maxRuns: number;
  startAt: number; // unix seconds
  expiry: number; // unix seconds
  nonce: string; // uint256
  signature: string; // ECDSA (EOA) or EIP-1271 (smart account) signature bytes
}

export function isAutopayExecutorConfigured(): boolean {
  // The relayer (OPERATOR) submits; it validates its own key/CDP config at send time. The store gate
  // (Pay DB) is checked separately by the runner.
  return true;
}

function parseMandate(raw: string): DepositMandate {
  const m = JSON.parse(raw) as DepositMandate;
  if (!m.depositor || !m.token || !m.amountPerRun || !m.signature) {
    throw new Error('Autopay mandate is malformed.');
  }
  return m;
}

/**
 * Run one autopay rule end-to-end: submit the mandate deposit via the relayer, advance/record the
 * schedule, and award equity credits from the verified on-chain amount. Shared by the scheduler and
 * the "run now" endpoint. Never throws.
 */
export async function executeAutopayRule(
  rule: AutopayRule & { approval: string },
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  try {
    const m = parseMandate(rule.approval);
    const config = savingsGaslessService.resolveConfig(rule.chainId); // vaultAddress, usdcAddress

    const txHash = await savingsRelayerService.executeMandateDeposit(rule.chainId, config.vaultAddress, {
      depositor: m.depositor,
      token: m.token,
      amountPerRun: BigInt(m.amountPerRun),
      interval: m.interval,
      maxRuns: m.maxRuns,
      startAt: BigInt(m.startAt),
      expiry: BigInt(m.expiry),
      nonce: BigInt(m.nonce),
      signature: m.signature,
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

/** EIP-712 domain + types for the vault DepositMandate (used to verify/relay; the client signs this). */
export function mandateTypedData(chainId: number, vaultAddress: string) {
  return {
    domain: { name: 'ESADepositVault', version: '1', chainId, verifyingContract: ethers.getAddress(vaultAddress) },
    types: {
      DepositMandate: [
        { name: 'depositor', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amountPerRun', type: 'uint256' },
        { name: 'interval', type: 'uint64' },
        { name: 'maxRuns', type: 'uint32' },
        { name: 'startAt', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
  };
}
