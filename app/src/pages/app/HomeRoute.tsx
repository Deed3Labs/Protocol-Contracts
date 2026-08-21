import { useEffect, useState } from 'react';
import HomePage from './HomePage';
import { HOME_IN_USE } from '@/data/clearPlaceholder';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import { useAppKitAccount } from '@/lib/walletCompat';
import { toActivityRow } from '@/lib/activityMapping';
import { getLithicAccount, getPaySummary, type LithicAccountResponse, type PaySummary } from '@/utils/apiClient';

/**
 * Live Home — everything except credit.
 *
 * Balances, savings, equity credits, recent activity and the deposit numbers behind "Account
 * details" are all real. What stays on placeholder is the credit half: the tiered line, the cycle,
 * the limit backing and term plans. None of those can be read from anywhere yet -- two of the four
 * tiers exist only as off-chain attestations, so they arrive with the credit route rather than
 * from chain (see docs/contracts/clear-deployment-plan.md, Phase D).
 *
 * The account numbers are fetched and never cached to disk: they are bank details, and the server
 * reads them from Lithic on demand for the same reason.
 */
export default function HomeRoute() {
  const { address } = useAppKitAccount();
  const { cash, savings, loading: balancesLoading } = useClearBalances();
  const { items, loading: txLoading } = useClearTransactions();
  const [lithic, setLithic] = useState<LithicAccountResponse | null>(null);
  const [pay, setPay] = useState<PaySummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLithicAccount().then((result) => {
      if (!cancelled) setLithic(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const deposit = lithic?.deposit ?? null;
  // Only override a figure once it has been read. A zero balance mid-fetch tells a member their
  // money is gone, which is a worse thing to show than the placeholder it would replace.
  const haveBalances = Boolean(address) && !balancesLoading;

  const data = {
    ...HOME_IN_USE,
    ...(haveBalances ? { cash } : {}),
    savings: {
      ...HOME_IN_USE.savings,
      ...(haveBalances ? { cash: savings } : {}),
      ...(pay
        ? { credits: pay.totalEquity, vested: pay.vestedEquity, vesting: pay.pendingEquity }
        : {}),
    },
    ...(deposit
      ? {
          cashAccount: {
            ...HOME_IN_USE.cashAccount,
            accountNumber: deposit.accountNumber,
            routingNumber: deposit.routingNumber,
          },
        }
      : {}),
    // Home shows a preview; Activity shows the list. Empty is the honest answer for a new member,
    // and the page has a state for it.
    ...(txLoading ? {} : { recent: items.slice(0, 4).map(toActivityRow) }),
  };

  return <HomePage data={data} />;
}
