import { useEffect, useState } from 'react';
import EarnPage from './EarnPage';
import { EARN_IN_USE, SAVINGS_IN_USE } from '@/data/clearPlaceholder';
import { toEarnData } from '@/lib/earnMapping';
import { projectReserveDate } from '@/lib/reserveProjection';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getEarn, getPaySummary, type EarnState, type PaySummary } from '@/utils/apiClient';

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
    void Promise.all([getEarn(address), getPaySummary(address)]).then(([e, p]) => {
      if (cancelled) return;
      setEarn(e);
      setPay(p);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const reserveDate = pay
    ? projectReserveDate(pay.totalEquity, pay.equityThisMonth, SAVINGS_IN_USE.milestones)
    : null;

  const data = earn?.complete
    ? toEarnData(earn.pool, earn.bonds, earn.terms, earn.earnedToDateCents, reserveDate, EARN_IN_USE)
    : EARN_IN_USE;

  return <EarnPage data={data} />;
}
