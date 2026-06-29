import { useEffect, useState } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getPortfolioHistory, type PortfolioHistoryPoint } from '@/utils/apiClient';
import { useClearBalances } from '@/hooks/useClearBalances';
import { useExternalAccounts } from '@/context/ExternalAccountsContext';

/**
 * Portfolio value history from the backend snapshot store (on-chain stablecoins + Plaid bank).
 * Fetches the full series once ('All'); the chart slices to the selected range. `currentTotal` is a
 * fallback so the chart shows the real balance (flat) when no history exists yet (pre-backfill /
 * unconfigured backend), instead of mock data.
 */
export interface ClearPortfolioHistory {
  points: PortfolioHistoryPoint[];
  currentTotal: number;
  loading: boolean;
}

export function useClearPortfolioHistory(): ClearPortfolioHistory {
  const { address, isConnected } = useAppKitAccount();
  const { cash, savings } = useClearBalances();
  const { totalBalance } = useExternalAccounts();
  const [points, setPoints] = useState<PortfolioHistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) {
      setPoints([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await getPortfolioHistory(address, 'All');
        if (!cancelled) setPoints(res?.points ?? []);
      } catch {
        if (!cancelled) setPoints([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  return { points, currentTotal: cash + savings + totalBalance, loading };
}
