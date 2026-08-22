import { useEffect, useState } from 'react';
import HomePage from './HomePage';
import { HOME_DAY_ONE } from '@/data/clearPlaceholder';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import { useAppKitAccount } from '@/lib/walletCompat';
import { toActivityRow } from '@/lib/activityMapping';
import { toCredit, toCycle, toLimitBacking } from '@/lib/creditMapping';
import {
  getCredit,
  getLithicAccount,
  getPaySummary,
  type CreditState,
  type LithicAccountResponse,
  type PaySummary,
} from '@/utils/apiClient';

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
 * Live Home.
 *
 * Balances, savings, equity credits, recent activity, the deposit numbers behind "Account details"
 * and now the credit tiers are all real. The tiers come from /api/credit, which reads the
 * contracts rather than recomputing what they already decide.
 *
 * Carry cost, the cycle and the limit backing are read too. All three were assumed to need
 * contract changes and none did -- `carryOf`, `creditPeriods` and `collateralValueOf` were already
 * there, which is worth remembering before proposing an upgrade next time.
 *
 * What remains placeholder is term plans, and that waits on nothing but a member having one.
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
  const [credit, setCredit] = useState<CreditState | null>(null);

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

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    // Null covers both "no credit line" and "could not read the chain", and the route distinguishes
    // them with a 503 for the second. Either way the placeholder stands rather than a zeroed line:
    // telling a member their credit is gone because an RPC timed out is the worse mistake.
    void getCredit(address).then((result) => {
      if (!cancelled) setCredit(result);
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
    ...HOME_DAY_ONE,
    ...(haveBalances ? { cash } : {}),
    savings: {
      ...HOME_DAY_ONE.savings,
      ...(haveBalances ? { cash: savings } : {}),
      ...(pay
        ? { credits: pay.totalEquity, vested: pay.vestedEquity, vesting: pay.pendingEquity }
        : {}),
    },
    ...(deposit
      ? {
          cashAccount: {
            ...HOME_DAY_ONE.cashAccount,
            accountNumber: deposit.accountNumber,
            routingNumber: deposit.routingNumber,
          },
        }
      : {}),
    // Home shows a preview; Activity shows the list. Empty is the honest answer for a new member,
    // and the page has a state for it.
    ...(txLoading ? {} : { recent: items.slice(0, 4).map(toActivityRow) }),
    ...(credit?.complete
      ? {
          credit: toCredit(credit.tiers, HOME_DAY_ONE.credit),
          cycle: toCycle(credit.cycle, HOME_DAY_ONE.cycle),
          backing: toLimitBacking(credit.tiers, HOME_DAY_ONE.backing),
        }
      : {}),
  };

  return <HomePage data={data} />;
}
