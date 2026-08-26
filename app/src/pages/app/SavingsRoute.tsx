import { useEffect, useState } from 'react';
import SavingsPage from './SavingsPage';
import { SAVINGS_DAY_ONE } from '@/data/clearPlaceholder';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getPaySummary, type PaySummary } from '@/utils/apiClient';
import { onChainStale } from '@/lib/chainStale';

/*
 * Day-one, not in-use.
 *
 * The `*_IN_USE` datasets are the DESIGN PREVIEW's populated fixtures -- a fully furnished account
 * used to show what the page looks like with money in it. Falling back to them in the real app
 * meant a member with nothing, or one whose fetch had not landed, was shown somebody else's
 * balances rendered as their own. That is not a placeholder, it is a fabrication.
 *
 * `*_DAY_ONE` is the honest base: zeros, empty lists, and products in their locked or
 * not-yet-activated state. Real figures are spread over it as they arrive, so a member who does
 * have money still never watches it flash to zero -- each field only overrides once it has been
 * read.
 */

/**
 * Live Savings — the balance and the equity credits behind it.
 *
 * Two sources, because they are two different kinds of fact. The savings balance is CLRUSD the
 * member holds, read from chain through the balances provider. Equity credits are a co-op ledger:
 * earned by saving and by paying bills on time, vesting on a schedule, and kept off-chain for now
 * (see the Pay equity ledger). Nothing on chain knows what a credit is.
 *
 * The credits come from the Pay summary rather than a savings endpoint, which reads oddly and is
 * correct: `/api/pay/:wallet/summary` is where the equity ledger is totalled, and savings-match
 * credits land in the same ledger as rent and bill credits. A second endpoint returning the same
 * numbers would be a second place for them to disagree.
 *
 * Everything else on the page -- the projection, milestones, assurance items, the vesting
 * schedule -- is still placeholder. Each falls back rather than blanking, because a member with a
 * real balance and an empty page has been told something false about their savings.
 */
export default function SavingsRoute() {
  const { address } = useAppKitAccount();
  const { savings: savingsBalance, loading } = useClearBalances();
  const [pay, setPay] = useState<PaySummary | null>(null);

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

  // Only override once the balance has actually been read. Showing zero while a fetch is in
  // flight reads as "you have nothing saved", which is a worse lie than the placeholder.
  const haveBalance = Boolean(address) && !loading;

  const data = {
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

  return <SavingsPage data={data} />;
}
