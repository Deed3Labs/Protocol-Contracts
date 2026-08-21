import { useEffect, useState } from 'react';
import SavingsPage from './SavingsPage';
import { SAVINGS_IN_USE } from '@/data/clearPlaceholder';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getPaySummary, type PaySummary } from '@/utils/apiClient';

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
    void getPaySummary(address).then((result) => {
      if (!cancelled) setPay(result);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Only override once the balance has actually been read. Showing zero while a fetch is in
  // flight reads as "you have nothing saved", which is a worse lie than the placeholder.
  const haveBalance = Boolean(address) && !loading;

  const data = {
    ...SAVINGS_IN_USE,
    savings: {
      ...SAVINGS_IN_USE.savings,
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
