import { useCallback } from 'react';
import { readContract } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import { useOptionalAddress, useOptionalSmartWalletClient } from './useOptionalWallet';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';
import { SAVINGS_TIER_ID, scPayPlan, scPayPlanFromSavings, scRepayWrittenOff, scSetSplit, scRepayCredit, scRepayFromSavings, STABLE_CREDIT_ABI, TERM_PLAN_ABI, TIER_PRINCIPAL_ABI } from '@/lib/sendCalls';
import { recordCreditRepayment } from '@/utils/apiClient';
import { markChainStale } from '@/lib/chainStale';

export interface RepayOutcome {
  /** What actually went to the chain — can be less than asked when part is still pending. */
  repaid?: number;
  /** Asked for more than has settled: the rest can be repaid once it does. */
  pendingLeft?: number;
  error?: string;
}

/**
 * Repay card debt in USDC from the member's own wallet.
 *
 * Only what has SETTLED is on chain, and the contract refuses to repay more than that — a card
 * purchase still pending is a hold, not debt, and becomes repayable when it clears. So the amount is
 * capped at the on-chain balance at the moment of repaying, and what is left is named rather than
 * silently dropped.
 */
export function useCreditRepay(): (amount: number) => Promise<RepayOutcome> {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();

  return useCallback(
    async (amount: number) => {
      if (!address) return { error: 'Connect a wallet first.' };
      const chainId = ACTIVE_CHAIN_ID;
      const c = clearContracts(chainId);
      if (!c?.stableCredit) return { error: 'Repaying on chain is not available on this network yet.' };

      try {
        const owedUnits = (await readContract(wagmiAdapter.wagmiConfig, {
          address: c.stableCredit,
          abi: STABLE_CREDIT_ABI,
          functionName: 'creditBalanceOf',
          args: [address as `0x${string}`],
          chainId,
        })) as bigint;
        // Rounded UP to the cent for comparing: asking to clear $0.03 when $0.026197 is owed means
        // "clear it", and it is cleared to the unit rather than leaving $0.006197 of carry behind.
        const owed = Math.ceil(Number(owedUnits) / 10_000) / 100;
        const clearsAll = amount >= owed;
        const repay = Math.min(amount, owed);
        if (owedUnits === 0n) return { error: 'Nothing has settled yet. Card purchases can be repaid once they clear.', pendingLeft: amount };

        const client = getClientForChain ? await getClientForChain({ id: chainId }).catch(() => undefined) : undefined;
        const hash = await scRepayCredit({
          smartWalletClient: client,
          ownerWallet: address,
          amount: repay.toFixed(2),
          chainId,
          ...(clearsAll ? { units: owedUnits } : {}),
        });
        markChainStale();
        const recorded = await recordCreditRepayment(address, hash);
        return {
          repaid: repay,
          pendingLeft: Math.max(0, Math.round((amount - repay) * 100) / 100),
          // Repaid either way; the books catch up on the next read if recording lagged the chain.
          ...(recorded.ok ? {} : { error: 'Repaid. It may take a moment to show here.' }),
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'That did not go through. Nothing was repaid.' };
      }
    },
    [address, getClientForChain],
  );
}

/**
 * Repay savings-backed credit out of the member's own savings.
 *
 * Capped at what the savings tier owes on chain -- savings beyond that are not locked and stay the
 * member's. The server records it against the savings tier, the one the chain settled.
 */
export function useRepayFromSavings(): (amount: number) => Promise<RepayOutcome> {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();

  return useCallback(
    async (amount: number) => {
      if (!address) return { error: 'Connect a wallet first.' };
      const chainId = ACTIVE_CHAIN_ID;
      const c = clearContracts(chainId);
      if (!c?.revolvingIssuer || !c.liquidator) return { error: 'Repaying from savings is not available on this network yet.' };
      try {
        const owedUnits = (await readContract(wagmiAdapter.wagmiConfig, {
          address: c.revolvingIssuer,
          abi: TIER_PRINCIPAL_ABI,
          functionName: 'principalOf',
          args: [address as `0x${string}`, SAVINGS_TIER_ID],
          chainId,
        })) as bigint;
        const owed = Math.floor(Number(owedUnits / 10_000n)) / 100;
        const repay = Math.min(amount, owed);
        if (repay <= 0) return { error: 'Nothing savings-backed has settled yet. It can be repaid once it clears.', pendingLeft: amount };

        const client = getClientForChain ? await getClientForChain({ id: chainId }).catch(() => undefined) : undefined;
        const hash = await scRepayFromSavings({ smartWalletClient: client, ownerWallet: address, amount: repay.toFixed(2), chainId });
        markChainStale();
        const recorded = await recordCreditRepayment(address, hash);
        return {
          repaid: repay,
          pendingLeft: Math.max(0, Math.round((amount - repay) * 100) / 100),
          ...(recorded.ok ? {} : { error: 'Repaid. It may take a moment to show here.' }),
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'That did not go through. Nothing was repaid.' };
      }
    },
    [address, getClientForChain],
  );
}

/**
 * Pay a term plan in USDC from the member's own wallet, by naming it.
 *
 * `payoff` clears the plan outright. What a plan owes grows by the second as carry accrues, so the
 * figure on screen is a moment old by the time it lands; paying off reads what is owed on chain and
 * approves a cent over, and `payPlan` takes only what is owed. A part payment pays what was asked.
 */
export function usePayPlan(): (
  planId: number,
  amount: number,
  payoff?: boolean,
  fromSavings?: boolean,
  /** 1 once the payment is sent, 2 once it is on chain and being recorded. */
  onStep?: (step: number) => void,
) => Promise<RepayOutcome> {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();

  return useCallback(
    async (planId: number, amount: number, payoff = false, fromSavings = false, onStep?: (step: number) => void) => {
      if (!address) return { error: 'Connect a wallet first.' };
      const chainId = ACTIVE_CHAIN_ID;
      const c = clearContracts(chainId);
      if (!c?.termIssuer) return { error: 'Paying plans on chain is not available on this network yet.' };
      try {
        const owedUnits = (await readContract(wagmiAdapter.wagmiConfig, {
          address: c.termIssuer,
          abi: TERM_PLAN_ABI,
          functionName: 'owedOn',
          args: [BigInt(planId)],
          chainId,
        })) as bigint;
        if (owedUnits === 0n) return { error: 'This plan is already paid.' };
        const asked = BigInt(Math.round(amount * 100)) * 10_000n;
        const units = payoff || asked >= owedUnits ? owedUnits + 10_000n : asked;
        const paying = Number(units < owedUnits ? units : owedUnits) / 1_000_000;

        const client = getClientForChain ? await getClientForChain({ id: chainId }).catch(() => undefined) : undefined;
        const hash = fromSavings
          ? await scPayPlanFromSavings({ smartWalletClient: client, ownerWallet: address, planId, units, chainId })
          : await scPayPlan({ smartWalletClient: client, ownerWallet: address, planId, units, chainId });
        // The batch resolves once it is on chain: taken and paid. What is left is our record of it.
        onStep?.(2);
        markChainStale();
        const recorded = await recordCreditRepayment(address, hash);
        return {
          repaid: Math.round(paying * 100) / 100,
          ...(recorded.ok ? {} : { error: 'Paid. It may take a moment to show here.' }),
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'That did not go through. Nothing was paid.' };
      }
    },
    [address, getClientForChain],
  );
}

/**
 * Re-split what is left of a plan, on chain. The member signs it; `setSplit` carries anything they
 * are behind into the new schedule as due now, so a re-split never clears arrears.
 */
export function useSetPlanSplit(): (planId: number, installments: number) => Promise<{ ok?: boolean; error?: string }> {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();

  return useCallback(
    async (planId: number, installments: number) => {
      if (!address) return { error: 'Connect a wallet first.' };
      const chainId = ACTIVE_CHAIN_ID;
      try {
        const client = getClientForChain ? await getClientForChain({ id: chainId }).catch(() => undefined) : undefined;
        await scSetSplit({ smartWalletClient: client, ownerWallet: address, planId, installments, chainId });
        markChainStale();
        return { ok: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'That did not go through. The split is unchanged.' };
      }
    },
    [address, getClientForChain],
  );
}

/**
 * Pay back what a term default wrote off, from the member's USDC. Clearing the rest of it also
 * reinstates them in the same batch, so term plans come back without waiting for anyone.
 */
export function useRepayWrittenOff(): (amount: number, remaining: number) => Promise<RepayOutcome> {
  const address = useOptionalAddress();
  const getClientForChain = useOptionalSmartWalletClient();

  return useCallback(
    async (amount: number, remaining: number) => {
      if (!address) return { error: 'Connect a wallet first.' };
      const chainId = ACTIVE_CHAIN_ID;
      try {
        const pay = Math.min(amount, remaining);
        const units = BigInt(Math.round(pay * 100)) * 10_000n;
        const client = getClientForChain ? await getClientForChain({ id: chainId }).catch(() => undefined) : undefined;
        await scRepayWrittenOff({ smartWalletClient: client, ownerWallet: address, units, clearsIt: pay >= remaining, chainId });
        markChainStale();
        return { repaid: pay };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'That did not go through. Nothing was paid.' };
      }
    },
    [address, getClientForChain],
  );
}
