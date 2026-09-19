import { useRemembered } from '@/lib/rememberedState';
import { useEffect } from 'react';
import { SAVINGS_DAY_ONE } from '@/data/clearPlaceholder';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getPaySummary, type PaySummary } from '@/utils/apiClient';
import { onChainStale } from '@/lib/chainStale';
import type { SavingsData } from '@/lib/clearModel';

/*
 * Day-one, not in-use.
 *
 * The `*_IN_USE` datasets are the DESIGN PREVIEW's populated fixtures — a fully furnished account
 * used to show what a page looks like with money in it. Falling back to them in the real app shows
 * a member somebody else's balances rendered as their own, which is a fabrication rather than a
 * placeholder. `*_DAY_ONE` is the honest base, and real figures are spread over it as they arrive.
 */

/**
 * The savings picture: the balance, and the equity credits behind it.
 *
 * Two sources, because they are two different kinds of fact. The savings balance is CLRUSD the
 * member holds, read from chain through the balances provider. Equity credits are a co-op ledger —
 * earned by saving and by paying bills on time, vesting on a schedule, kept off-chain for now.
 * Nothing on chain knows what a credit is.
 *
 * The credits come from the Pay summary rather than a savings endpoint, which reads oddly and is
 * correct: `/api/pay/:wallet/summary` is where the equity ledger is totalled, and savings-match
 * credits land in the same ledger as rent and bill credits. A second endpoint returning the same
 * numbers would be a second place for them to disagree.
 *
 * A HOOK rather than a block inside the Savings route, because two pages need it. Assurance is the
 * same credits seen from the other side: which protections are on is decided by the member's credit
 * total, and the pane was rendering against the day-one fixture — zero credits — while the Savings
 * cell it was opened from rendered against the real figure. So a member with 1,500 credits read
 * "2 of 4 active" and then a pane telling them the second protection was 1,000 credits away. Two
 * screens in one flow, disagreeing about the same member, because each fetched for itself.
 */
export function useSavingsData(): SavingsData {
  const { address } = useAppKitAccount();
  const { savings: savingsBalance, loading } = useClearBalances();
  // Same key as Home and Earn: the pay summary is one read, remembered for the session.
  const [pay, setPay] = useRemembered<PaySummary | null>(`pay:${address ?? ''}`, null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const read = () => {
      void getPaySummary(address).then((result) => {
        if (!cancelled) setPay(result);
      });
    };
    read();

    // Equity credits are minted by the same deposit that moves the balance, and they were the one
    // figure on this page that stayed put until a navigation.
    const stopListening = onChainStale(read);

    return () => {
      cancelled = true;
      stopListening();
    };
  }, [address]);

  // Only override once the balance has actually been read. Showing zero while a fetch is in flight
  // reads as "you have nothing saved", which is a worse lie than the placeholder.
  const haveBalance = Boolean(address) && !loading;

  return {
    ...SAVINGS_DAY_ONE,
    savings: {
      ...SAVINGS_DAY_ONE.savings,
      ...(haveBalance ? { cash: savingsBalance } : {}),
      ...(pay
        ? {
            credits: pay.totalEquity,
            vested: pay.vestedEquity,
            vesting: pay.pendingEquity,
          }
        : {}),
    },
  };
}
