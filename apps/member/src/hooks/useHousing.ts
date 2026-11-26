import { useCallback, useEffect, useState } from 'react';
import { useOptionalAddress } from './useOptionalWallet';
import { getCreditsOnChain, getHousing } from '@/utils/apiClient';
import { housingFrom, NO_HOUSING, type Housing } from '@/lib/housing';

/**
 * The member's Housing Allowance and credits, from the chain through the API. Starts at none and
 * stays there on a failed read, so nothing is shown that was not read. `refresh` reads again after
 * the member redeems or pays.
 */
export function useHousing(homeName?: string): { housing: Housing; refresh: () => void } {
  const address = useOptionalAddress();
  const [housing, setHousing] = useState<Housing>(NO_HOUSING);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    Promise.all([getHousing(address).catch(() => null), getCreditsOnChain(address).catch(() => null)]).then(([read, credits]) => {
      if (!cancelled && (read || credits)) setHousing(housingFrom(read, credits, homeName));
    });
    return () => {
      cancelled = true;
    };
  }, [address, homeName, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { housing, refresh };
}
