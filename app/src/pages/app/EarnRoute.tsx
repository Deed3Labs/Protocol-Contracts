import { useEffect, useState } from 'react';
import EarnPage from './EarnPage';
import { EARN_IN_USE } from '@/data/clearPlaceholder';
import { toEarnData } from '@/lib/earnMapping';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getEarn, type EarnState } from '@/utils/apiClient';

/**
 * Live Earn — the lending pool and the member's bonds.
 *
 * Terms are priced by the collection rather than by a copy of its discount curve. The curve is
 * configurable per collection and its shape is a product decision, so a second implementation here
 * would quote prices the contract might not honour — and a price a member cannot actually get is
 * worse than no price.
 *
 * Bonds show what they are worth today, not their face. That is what the credit line lends
 * against, and it is the only figure that moves between purchase and maturity.
 */
export default function EarnRoute() {
  const { address } = useAppKitAccount();
  const [earn, setEarn] = useState<EarnState | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void getEarn(address).then((result) => {
      if (!cancelled) setEarn(result);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const data = earn?.complete
    ? toEarnData(earn.pool, earn.bonds, earn.terms, EARN_IN_USE)
    : EARN_IN_USE;

  return <EarnPage data={data} />;
}
