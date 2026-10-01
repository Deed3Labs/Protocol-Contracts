import { useEffect } from 'react';
import { getCredit, type CreditState } from '@/utils/apiClient';
import { onChainStale } from '@/lib/chainStale';
import { keepLastGood } from '@/lib/keepLastGood';
import { useRemembered, walletKey } from '@/lib/rememberedState';
import { cycleStartOf } from '@/lib/creditFigures';

export { cycleStartOf } from '@/lib/creditFigures';

/*
 * Two readers on one page (Send reads the cycle and the partner credit) share one chain read: a
 * request already on its way for the same wallet is reused rather than sent again.
 */
const inFlight = new Map<string, Promise<CreditState | null>>();
function readCredit(address: string): Promise<CreditState | null> {
  const key = address.toLowerCase();
  const running = inFlight.get(key);
  if (running) return running;
  const p = getCredit(address).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * The member's credit line, remembered on the device and read again after any move. The same
 * remembered read as Activity and Home (`credit:<wallet>`), so a page starts from whichever read it
 * last. Null until something has been read.
 */
export function useCredit(address: string | undefined): CreditState | null {
  const [credit, setCredit] = useRemembered<CreditState | null>(`credit:${walletKey(address)}`, null);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const read = () => {
      void readCredit(address).then((result) => {
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
  return credit;
}

export function useCycleStart(address: string | undefined): number {
  return cycleStartOf(useCredit(address));
}
