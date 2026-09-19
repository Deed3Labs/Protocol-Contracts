import { useEffect, useState } from 'react';
import { getCreditRepayments, type CreditRepaymentEntry } from '@/utils/apiClient';
import { onChainStale } from '@/lib/chainStale';
import { useRemembered } from '@/lib/rememberedState';

/**
 * The member's repayments, for Activity and Home's recent list.
 *
 * Re-read whenever something moves money (onChainStale), like the credit figures beside them -- a
 * repayment that appears only after a manual refresh reads as one that did not happen.
 */
export function useCreditRepayments(address: string | undefined): CreditRepaymentEntry[] {
  const [repayments, setRepayments] = useRemembered<CreditRepaymentEntry[]>(`repayments:${address ?? ''}`, []);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const read = () => {
      void getCreditRepayments(address).then((list) => {
        if (!cancelled) setRepayments(list);
      });
    };
    read();
    const stop = onChainStale(read);
    return () => {
      cancelled = true;
      stop();
    };
  }, [address]);
  return repayments;
}
