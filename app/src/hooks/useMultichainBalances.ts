import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { SUPPORTED_NETWORKS, getRpcUrlForNetwork, getNetworkByChainId } from '@/config/networks';
import { getEthereumProvider } from '@/utils/providerUtils';
import { usePricingData } from './usePricingData';

export interface MultichainBalance {
  chainId: number;
  chainName: string;
  balance: string;
  balanceWei: bigint;
  balanceUSD: number;
  currencySymbol: string;
  currencyName: string;
  isLoading: boolean;
  error: string | null;
}

interface UseMultichainBalancesReturn {
  balances: MultichainBalance[];
  totalBalance: string;
  totalBalanceUSD: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshChain: (chainId: number) => Promise<void>;
}

/**
 * Hook to fetch native token balances across all supported networks
 */
export function useMultichainBalances(): UseMultichainBalancesReturn {
  const { address, isConnected } = useAppKitAccount();
  const [balances, setBalances] = useState<MultichainBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Get ETH price for USD conversion (using mainnet price as reference)
  const { price: ethPrice } = usePricingData();

  // Get provider for a specific chain
  const getChainProvider = useCallback(async (chainId: number): Promise<ethers.Provider> => {
    try {
      // Try to use the wallet provider if it's on the correct chain
      const provider = await getEthereumProvider();
      const network = await provider.getNetwork();
      
      if (network.chainId === BigInt(chainId)) {
        return provider;
      }
    } catch (error) {
      // Fall through to RPC provider
    }

    // Fallback to RPC provider for the specific chain
    const rpcUrl = getRpcUrlForNetwork(chainId);
    if (!rpcUrl) {
      throw new Error(`No RPC URL available for chain ${chainId}`);
    }
    return new ethers.JsonRpcProvider(rpcUrl);
  }, []);

  // Fetch balance for a specific chain
  const fetchChainBalance = useCallback(async (chainId: number): Promise<MultichainBalance> => {
    if (!address) {
      throw new Error('No address available');
    }

    const networkConfig = getNetworkByChainId(chainId);
    if (!networkConfig) {
      throw new Error(`Network ${chainId} not supported`);
    }

    try {
      const provider = await getChainProvider(chainId);
      const balanceWei = await provider.getBalance(address);
      const balance = parseFloat(ethers.formatEther(balanceWei)).toFixed(4);
      const balanceUSD = parseFloat(balance) * (ethPrice || 0);

      return {
        chainId,
        chainName: networkConfig.name,
        balance,
        balanceWei,
        balanceUSD,
        currencySymbol: networkConfig.nativeCurrency.symbol,
        currencyName: networkConfig.nativeCurrency.name,
        isLoading: false,
        error: null,
      };
    } catch (err) {
      console.error(`Error fetching balance for chain ${chainId}:`, err);
      return {
        chainId,
        chainName: networkConfig.name,
        balance: '0.00',
        balanceWei: 0n,
        balanceUSD: 0,
        currencySymbol: networkConfig.nativeCurrency.symbol,
        currencyName: networkConfig.nativeCurrency.name,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch balance',
      };
    }
  }, [address, getChainProvider, ethPrice]);

  // Refresh a specific chain
  const refreshChain = useCallback(async (chainId: number) => {
    if (!isConnected || !address) return;

    setBalances(prev => {
      const updated = [...prev];
      const index = updated.findIndex(b => b.chainId === chainId);
      if (index >= 0) {
        updated[index] = { ...updated[index], isLoading: true, error: null };
      }
      return updated;
    });

    try {
      const balance = await fetchChainBalance(chainId);
      setBalances(prev => {
        const updated = [...prev];
        const index = updated.findIndex(b => b.chainId === chainId);
        if (index >= 0) {
          updated[index] = balance;
        } else {
          updated.push(balance);
        }
        return updated;
      });
    } catch (err) {
      setBalances(prev => {
        const updated = [...prev];
        const index = updated.findIndex(b => b.chainId === chainId);
        if (index >= 0) {
          updated[index] = {
            ...updated[index],
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to fetch balance',
          };
        }
        return updated;
      });
    }
  }, [isConnected, address, fetchChainBalance]);

  // Refresh all chains
  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setBalances([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Initialize balances for all networks
    const initialBalances: MultichainBalance[] = SUPPORTED_NETWORKS.map(network => ({
      chainId: network.chainId,
      chainName: network.name,
      balance: '0.00',
      balanceWei: 0n,
      balanceUSD: 0,
      currencySymbol: network.nativeCurrency.symbol,
      currencyName: network.nativeCurrency.name,
      isLoading: true,
      error: null,
    }));
    setBalances(initialBalances);

    try {
      // Fetch all chains in parallel
      const balancePromises = SUPPORTED_NETWORKS.map(network => fetchChainBalance(network.chainId));
      const results = await Promise.all(balancePromises);
      setBalances(results);
    } catch (err) {
      console.error('Error fetching multichain balances:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, fetchChainBalance]);

  // Initial load and refresh on address/connection change
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh every 30 seconds
  useEffect(() => {
    if (!isConnected || !address) return;

    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [isConnected, address, refresh]);

  // Calculate totals
  const totalBalance = useMemo(() => {
    const total = balances.reduce((sum, b) => sum + parseFloat(b.balance || '0'), 0);
    return total.toFixed(4);
  }, [balances]);

  const totalBalanceUSD = useMemo(() => {
    return balances.reduce((sum, b) => sum + (b.balanceUSD || 0), 0);
  }, [balances]);

  return {
    balances,
    totalBalance,
    totalBalanceUSD,
    isLoading,
    error,
    refresh,
    refreshChain,
  };
}
