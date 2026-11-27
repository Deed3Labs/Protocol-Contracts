import { useEffect, useState } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getPlaidRecurringTransactions } from '@/utils/apiClient';
import type { UpcomingItem } from '@/components/app-ui/UpcomingCalendar';

/**
 * Upcoming recurring bills/income for the calendar, from Plaid's recurring-transactions detection
 * (predicted streams, normalized server-side to { stream_id, name, amount, day }). Empty until a
 * bank is linked + Plaid is active.
 */
export function useUpcoming(): UpcomingItem[] {
  const { address, isConnected } = useAppKitAccount();
  const [items, setItems] = useState<UpcomingItem[]>([]);

  useEffect(() => {
    if (!isConnected || !address) {
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await getPlaidRecurringTransactions(address);
        if (cancelled || !r) return;
        const out = r.outflowStreams.map((s) => ({ id: s.stream_id, name: s.name, amount: Math.abs(s.amount), day: s.day, direction: 'out' as const }));
        const inc = r.inflowStreams.map((s) => ({ id: s.stream_id, name: s.name, amount: Math.abs(s.amount), day: s.day, direction: 'in' as const }));
        setItems([...out, ...inc].filter((i) => i.day >= 1 && i.day <= 31));
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  return items;
}
