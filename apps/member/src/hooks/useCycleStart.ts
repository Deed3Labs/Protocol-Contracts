import { useEffect } from 'react';
import { getCredit, type CreditState } from '@/utils/apiClient';
import { onChainStale } from '@/lib/chainStale';
import { keepLastGood } from '@/lib/keepLastGood';
import { useRemembered, walletKey } from '@/lib/rememberedState';

/**
 * When this credit cycle began (ms), for "this cycle" figures: 0 when there's no readable cycle,
 * which the cycle maths reads as "everything loaded". The same remembered read as Activity and
 * Home (`credit:<wallet>`), so a page starts from whichever read it last.
 */
export function useCycleStart(address: string | undefined): number {
  const [credit, setCredit] = useRemembered<CreditState | null>(`credit:${walletKey(address)}`, null);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const read = () => {
      void getCredit(address).then((result) => {
        if (!cancelled) setCredit((prev) => keepLastGood(prev, result));
      });
    };
    read();
    const stop = onChainStale(read);
    return () => {
      cancelled = true;
      stop();
    };
  }, [address]);
  const cycle = credit?.complete ? credit.cycle : null;
  return cycle && cycle.issuedAt > 0 ? cycle.issuedAt * 1000 : 0;
}
