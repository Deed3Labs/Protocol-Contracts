import { useEffect, useState } from 'react';
import { getChargeHistory, type MemberCharge } from '@/utils/apiClient';
import { onChainStale } from '@/lib/chainStale';
import { useRemembered, walletKey } from '@/lib/rememberedState';

/* Two readers on one page (Send's last cell and its At partners) share one request. */
let inFlight: Promise<MemberCharge[] | null> | null = null;
function readHistory(): Promise<MemberCharge[] | null> {
  if (!inFlight) inFlight = getChargeHistory().finally(() => (inFlight = null));
  return inFlight;
}

/**
 * Every charge the member has had, for Send, the Charges page and Activity. Remembered on the device
 * (the page shows the last list at once), read again after any move and whenever the app comes back
 * to the front, since a charge can arrive while it was away. A failed read keeps what was shown.
 */
export function useChargeHistory(address: string | undefined): MemberCharge[] {
  return useChargeHistoryState(address).charges;
}

/** The same, with whether the server has answered yet (so an empty list isn't said too early). */
export function useChargeHistoryState(address: string | undefined): { charges: MemberCharge[]; loaded: boolean } {
  const [charges, setCharges] = useRemembered<MemberCharge[]>(`chargehistory:${walletKey(address)}`, []);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const read = () => {
      void readHistory().then((list) => {
        if (cancelled) return;
        if (list) setCharges(list);
        setLoaded(true);
      });
    };
    read();
    const stop = onChainStale(read);
    const onVisible = () => document.visibilityState === 'visible' && read();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [address]);
  return { charges, loaded };
}
