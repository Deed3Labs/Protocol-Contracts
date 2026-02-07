import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getPlaidInvestmentsHoldings,
  plaidInvestmentsRefresh,
  type PlaidInvestmentHolding,
} from '@/utils/apiClient';

/** Portfolio-compatible holding shape for Plaid investment (equity) holdings */
export interface PlaidEquityHolding {
  id: string;
  type: 'equity';
  asset_name: string;
  asset_symbol: string;
  balance?: string;
  balanceUSD: number;
  chainId: number;
  chainName: string;
  quantity: number;
  institution_price: number;
  cost_basis: number | null;
  security_id: string;
  account_id: string;
  item_id: string;
  security_type: string | null;
}

export interface UsePlaidInvestmentsHoldingsResult {
  holdings: PlaidEquityHolding[];
  linked: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Trigger Plaid on-demand investments refresh, then refetch holdings */
  refreshInvestments: () => Promise<void>;
}

function toEquityHolding(h: PlaidInvestmentHolding): PlaidEquityHolding {
  const symbol = h.ticker_symbol || h.name?.slice(0, 8) || 'SEC';
  return {
    id: `plaid-equity-${h.holding_id}`,
    type: 'equity',
    asset_name: h.name,
    asset_symbol: symbol,
    balance: String(h.quantity),
    balanceUSD: h.institution_value ?? 0,
    chainId: 0,
    chainName: 'Brokerage',
    quantity: h.quantity,
    institution_price: h.institution_price,
    cost_basis: h.cost_basis,
    security_id: h.security_id,
    account_id: h.account_id,
    item_id: h.item_id,
    security_type: h.security_type,
  };
}

/**
 * Fetches Plaid investment holdings (brokerage accounts) for the given wallet.
 * Returns holdings in a portfolio-compatible shape (type: 'equity') for merging into portfolio view.
 */
export function usePlaidInvestmentsHoldings(
  walletAddress: string | undefined
): UsePlaidInvestmentsHoldingsResult {
  const [holdings, setHoldings] = useState<PlaidInvestmentHolding[]>([]);
  const [linked, setLinked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHoldings = useCallback(async (skipCache?: boolean) => {
    if (!walletAddress) {
      setHoldings([]);
      setLinked(false);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await getPlaidInvestmentsHoldings(walletAddress, skipCache ? { skipCache: true } : undefined);
      setHoldings(result?.holdings ?? []);
      setLinked(result?.linked ?? false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load investment holdings');
      setHoldings([]);
      setLinked(false);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchHoldings();
  }, [fetchHoldings]);

  const refresh = useCallback(() => fetchHoldings(true), [fetchHoldings]);

  const refreshInvestments = useCallback(async () => {
    if (!walletAddress) return;
    try {
      await plaidInvestmentsRefresh(walletAddress);
      await fetchHoldings(true);
    } catch {
      await fetchHoldings(true);
    }
  }, [walletAddress, fetchHoldings]);

  const equityHoldings = useMemo(() => holdings.map(toEquityHolding), [holdings]);

  return {
    holdings: equityHoldings,
    linked,
    isLoading,
    error,
    refresh,
    refreshInvestments,
  };
}
