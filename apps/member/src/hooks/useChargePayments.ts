import { useEffect } from 'react';
import { getChargePayments, type ChargePayment } from '@/utils/apiClient';
import { onChainStale } from '@/lib/chainStale';
import { useRemembered, walletKey } from '@/lib/rememberedState';

/**
 * The member's charges paid now, for Activity. Read again after any move, like repayments: paying a
 * shop is one, and so is the refund that brings it back.
 */
export function useChargePayments(address: string | undefined): ChargePayment[] {
  const [payments, setPayments] = useRemembered<ChargePayment[]>(`chargepayments:${walletKey(address)}`, []);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const read = () => {
      void getChargePayments().then((list) => {
        if (!cancelled) setPayments(list);
      });
    };
    read();
    const stop = onChainStale(read);
    return () => {
      cancelled = true;
      stop();
    };
  }, [address]);
  return payments;
}
