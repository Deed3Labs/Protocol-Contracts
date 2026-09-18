import { useCallback } from 'react';
import { readContract } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import { useOptionalAddress, useOptionalSmartWalletClient } from './useOptionalWallet';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';
import { SAVINGS_TIER_ID, scRepayCredit, scRepayFromSavings, STABLE_CREDIT_ABI, TIER_PRINCIPAL_ABI } from '@/lib/sendCalls';
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
        const owed = Math.floor(Number(owedUnits / 10_000n)) / 100; // to cents, then dollars
        const repay = Math.min(amount, owed);
        if (repay <= 0) return { error: 'Nothing has settled yet. Card purchases can be repaid once they clear.', pendingLeft: amount };

        const client = getClientForChain ? await getClientForChain({ id: chainId }).catch(() => undefined) : undefined;
        const hash = await scRepayCredit({ smartWalletClient: client, ownerWallet: address, amount: repay.toFixed(2), chainId });
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
