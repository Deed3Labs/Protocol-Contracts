import { useEffect, useState } from 'react';
import EarnPage from './EarnPage';
import { EARN_DAY_ONE, MILESTONES } from '@/data/clearPlaceholder';
import { toEarnData } from '@/lib/earnMapping';
import { projectReserveDate } from '@/lib/reserveProjection';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getEarn, getPaySummary, type EarnState, type PaySummary } from '@/utils/apiClient';
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
 * Live Earn — the lending pool, the member's bonds, and what both have made.
 *
 * Terms are priced by the collection rather than by a copy of its discount curve. The curve is
 * configurable per collection and its shape is a product decision, so a second implementation here
 * would quote prices the contract might not honour — and a price a member cannot get is worse than
 * no price.
 *
 * Bonds show what they are worth today, not their face. That is what the credit line lends
 * against, and it is the only figure that moves between purchase and maturity.
 *
 * The reserve date comes from the equity ledger rather than from anything on this page: it is a
 * projection of credits and their accrual toward the milestone that reserves a home, so it needs
 * the Pay summary. Left on its fallback when the projection says nothing useful — a member earning
 * nothing a month is not on track for a date, and printing one would invent a future for them.
 */
export default function EarnRoute() {
  const { address } = useAppKitAccount();
  const [earn, setEarn] = useState<EarnState | null>(null);
  const [pay, setPay] = useState<PaySummary | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const read = () => {
      void Promise.all([getEarn(address), getPaySummary(address)]).then(([e, p]) => {
        if (cancelled) return;
        setEarn(e);
        setPay(p);
      });
    };
    read();

    /*
     * Re-read after a move, which this page previously did not do at all.
     *
     * Everything on Earn is downstream of a move: the pool position and its utilisation, the bond
     * list, and what both back on the credit line. A member who bought a bond here watched their
     * cash fall and the bond not appear until they changed page and came back.
     */
    const stopListening = onChainStale(read);

    return () => {
      cancelled = true;
      stopListening();
    };
  }, [address]);

  const reserveDate = pay
    ? projectReserveDate(pay.totalEquity, pay.equityThisMonth, MILESTONES)
    : null;

  const data = earn?.complete
    ? toEarnData(earn.pool, earn.bonds, earn.terms, earn.earnedToDateCents, reserveDate, EARN_DAY_ONE)
    : EARN_DAY_ONE;

  return <EarnPage data={data} />;
}
