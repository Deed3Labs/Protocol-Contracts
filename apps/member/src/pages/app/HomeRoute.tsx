import { useEffect, useState } from 'react';
import HomePage from './HomePage';
import { HOME_DAY_ONE } from '@/data/clearPlaceholder';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import { useAppKitAccount } from '@/lib/walletCompat';
import { toActivityRow } from '@/lib/activityMapping';
import { toCredit, toCycle, toLimitBacking, toTermPlans } from '@/lib/creditMapping';
import { onChainStale } from '@/lib/chainStale';
import { keepLastGood } from '@/lib/keepLastGood';
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
 * Term plans are real too now, which is what makes day one's two arrivals reachable: the page
 * reverses its order for a member who has an active plan, and a counter member who approved a
 * charge now has one. The locked rows beneath are kept — partner credit and an ELPA are products
 * nobody has unlocked yet, not fields that failed to load.
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

  /*
   * Everything on this page a move can change, read together.
   *
   * One effect and one listener on purpose. As two, the credit read refreshed after a deposit and
   * the equity ledger did not — so the limit moved while the credits feeding the savings card and
   * the ELPA row sat at their old figures until the member changed page. They are downstream of
   * the same deposit; splitting them was splitting one fact into two that could disagree.
   */
  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    // Null covers both "no credit line" and "could not read the chain", and the route distinguishes
    // them with a 503 for the second. Either way the placeholder stands rather than a zeroed line:
    // telling a member their credit is gone because an RPC timed out is the worse mistake.
    const read = () => {
      void getCredit(address).then((result) => {
        if (!cancelled) setCredit((prev) => keepLastGood(prev, result));
      });
      void getPaySummary(address).then((result) => {
        if (!cancelled) setPay(result);
      });
    };
    read();

    // Re-read after a move. The backoff and the reasoning live in `chainStale`, because this was
    // not the only reader and the copies drifted — the savings move signalled, the pool and bond
    // moves did not, and nothing outside this file was listening at all.
    const stopListening = onChainStale(read);

    return () => {
      cancelled = true;
      stopListening();
    };
  }, [address]);

  const deposit = lithic?.deposit ?? null;
  // Only override a figure once it has been read. A zero balance mid-fetch tells a member their
  // money is gone, which is a worse thing to show than the placeholder it would replace.
  const haveBalances = Boolean(address) && !balancesLoading;

  const data = {
    ...HOME_DAY_ONE,
    // NOT the USDC balance. `cash` is what can settle a card authorization and nothing else --
    // availableToSpend adds it straight to the credit line -- and USDC on the member's own smart
    // wallet cannot do that until it has been moved to the card float. Counting it here would
    // offer somebody spend the float cannot fund, which is the same mistake the snapshot service
    // is careful to avoid on the authorization side.
    //
    // Left at zero until a card balance is actually readable. The USDC is not hidden: it appears
    // as readyToAllocate below, which is the row that exists to say "yours, not spendable here".
    savings: {
      ...HOME_DAY_ONE.savings,
      ...(haveBalances ? { cash: savings } : {}),
      ...(pay
        ? { credits: pay.totalEquity, vested: pay.vestedEquity, vesting: pay.pendingEquity }
        : {}),
    },
    cashAccount: {
      ...HOME_DAY_ONE.cashAccount,
      // USDC on the member's own smart wallet: theirs, in the cash account, and able to go to
      // Savings or Earn but never to the card. This is where that balance belongs -- leaving it at
      // zero told a member holding 35 USDC that they had nothing to place.
      ...(haveBalances ? { readyToAllocate: cash } : {}),
      ...(deposit
        ? { accountNumber: deposit.accountNumber, routingNumber: deposit.routingNumber }
        : {}),
    },
    // Home shows a preview; Activity shows the list. Empty is the honest answer for a new member,
    // and the page has a state for it.
    ...(txLoading ? {} : { recent: items.slice(0, 4).map(toActivityRow) }),
    ...(credit?.complete
      ? {
          credit: toCredit(credit.tiers, HOME_DAY_ONE.credit, credit.term?.carryOwedCents ?? 0),
          cycle: toCycle(credit.cycle, HOME_DAY_ONE.cycle),
          backing: toLimitBacking(credit.tiers, HOME_DAY_ONE.backing),
          // The last placeholder on this page, and the one that made day one's two arrivals
          // unreachable: HomePage already reverses its order for a member who has a plan, and
          // until now no member could have one it could see.
          // Credits come from the equity ledger, so the ELPA row shows the member's real progress
          // toward it rather than a hardcoded zero.
          termPlans: toTermPlans(
            credit.plans,
            HOME_DAY_ONE.termPlans,
            pay ? { credits: pay.totalEquity, goal: HOME_DAY_ONE.savings.creditsGoal } : undefined,
          ),
        }
      : {}),
  };

  return <HomePage data={data} />;
}
