import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { SUPPORTED_NETWORKS, getRpcUrlForNetwork } from '@/config/networks';
import { getEthereumProvider } from '@/utils/providerUtils';

export interface ChainData {
  chainId: number;
  balance: string;
  balanceUSD: number;
  tokens: Array<{
    address: string;
    symbol: string;
    name: string;
    balance: string;
    balanceUSD: number;
    chainId: number;
  }>;
  nfts: Array<{
    tokenId: string;
    chainId: number;
    [key: string]: any;
  }>;
  transactions: Array<{
    id: string;
    chainId: number;
    [key: string]: any;
  }>;
  isLoading: boolean;
  error: string | null;
}

interface MultichainContextType {
  chainData: Map<number, ChainData>;
  aggregatedBalance: number;
  aggregatedBalanceUSD: number;
  allTokens: Array<ChainData['tokens'][0]>;
  allNFTs: Array<ChainData['nfts'][0]>;
  allTransactions: Array<ChainData['transactions'][0]>;
  isLoading: boolean;
  refreshAll: () => Promise<void>;
  refreshChain: (chainId: number) => Promise<void>;
}

const MultichainContext = createContext<MultichainContextType | null>(null);

export const MultichainProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { address, isConnected } = useAppKitAccount();
  const [chainData, setChainData] = useState<Map<number, ChainData>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Initialize chain data structure for all supported networks
  useEffect(() => {
    if (!isConnected) {
      setChainData(new Map());
      return;
    }

    const initialData = new Map<number, ChainData>();
    SUPPORTED_NETWORKS.forEach(network => {
      initialData.set(network.chainId, {
        chainId: network.chainId,
        balance: '0.00',
        balanceUSD: 0,
        tokens: [],
        nfts: [],
        transactions: [],
        isLoading: false,
        error: null,
      });
    });
    setChainData(initialData);
  }, [isConnected, address]);

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

  // Fetch native balance for a chain
  const fetchChainBalance = useCallback(async (chainId: number, address: string): Promise<{ balance: string; balanceUSD: number }> => {
    try {
      const provider = await getChainProvider(chainId);
      const balanceWei = await provider.getBalance(address);
      const balance = parseFloat(ethers.formatEther(balanceWei)).toFixed(4);
      
      // Get ETH price (simplified - in production, fetch per chain if needed)
      // For now, we'll use a single ETH price for all chains
      const ethPrice = 3000; // TODO: Fetch from pricing hook
      const balanceUSD = parseFloat(balance) * ethPrice;
      
      return { balance, balanceUSD };
    } catch (error) {
      console.error(`Error fetching balance for chain ${chainId}:`, error);
      return { balance: '0.00', balanceUSD: 0 };
    }
  }, [getChainProvider]);

  // Note: Token balances, NFTs, and transactions are handled by dedicated hooks:
  // - useMultichainTokenBalances
  // - useMultichainDeedNFTs
  // - useMultichainActivity
  // This context focuses on native balance aggregation

  // Refresh data for a specific chain
  const refreshChain = useCallback(async (chainId: number) => {
    if (!isConnected || !address) return;

    setChainData(prev => {
      const updated = new Map(prev);
      const current = updated.get(chainId) || {
        chainId,
        balance: '0.00',
        balanceUSD: 0,
        tokens: [],
        nfts: [],
        transactions: [],
        isLoading: true,
        error: null,
      };
      updated.set(chainId, { ...current, isLoading: true, error: null });
      return updated;
    });

    try {
      const [balanceData] = await Promise.all([
        fetchChainBalance(chainId, address),
      ]);

      setChainData(prev => {
        const updated = new Map(prev);
        const current = updated.get(chainId);
        if (current) {
          updated.set(chainId, {
            ...current,
            ...balanceData,
            isLoading: false,
            error: null,
          });
        }
        return updated;
      });
    } catch (error) {
      setChainData(prev => {
        const updated = new Map(prev);
        const current = updated.get(chainId);
        if (current) {
          updated.set(chainId, {
            ...current,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to fetch chain data',
          });
        }
        return updated;
      });
    }
  }, [isConnected, address, fetchChainBalance]);

  // Refresh all chains
  const refreshAll = useCallback(async () => {
    if (!isConnected || !address) return;

    setIsLoading(true);
    try {
      // Fetch all chains in parallel
      const promises = SUPPORTED_NETWORKS.map(network => refreshChain(network.chainId));
      await Promise.all(promises);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, refreshChain]);

  // Initial load
  useEffect(() => {
    if (isConnected && address) {
      refreshAll();
    }
  }, [isConnected, address, refreshAll]);

  // Aggregated values
  const aggregatedBalance = useMemo(() => {
    let total = 0;
    chainData.forEach(data => {
      total += parseFloat(data.balance) || 0;
    });
    return total;
  }, [chainData]);

  const aggregatedBalanceUSD = useMemo(() => {
    let total = 0;
    chainData.forEach(data => {
      total += data.balanceUSD || 0;
    });
    return total;
  }, [chainData]);

  const allTokens = useMemo(() => {
    const tokens: ChainData['tokens'] = [];
    chainData.forEach(data => {
      tokens.push(...data.tokens);
    });
    return tokens;
  }, [chainData]);

  const allNFTs = useMemo(() => {
    const nfts: ChainData['nfts'] = [];
    chainData.forEach(data => {
      nfts.push(...data.nfts);
    });
    return nfts;
  }, [chainData]);

  const allTransactions = useMemo(() => {
    const transactions: ChainData['transactions'] = [];
    chainData.forEach(data => {
      transactions.push(...data.transactions);
    });
    // Sort by timestamp (newest first)
    return transactions.sort((a, b) => {
      const aTime = a.timestamp || 0;
      const bTime = b.timestamp || 0;
      return bTime - aTime;
    });
  }, [chainData]);

  const value: MultichainContextType = {
    chainData,
    aggregatedBalance,
    aggregatedBalanceUSD,
    allTokens,
    allNFTs,
    allTransactions,
    isLoading,
    refreshAll,
    refreshChain,
  };

  return (
    <MultichainContext.Provider value={value}>
      {children}
    </MultichainContext.Provider>
  );
};

export const useMultichain = () => {
  const context = useContext(MultichainContext);
  if (!context) {
    throw new Error('useMultichain must be used within MultichainProvider');
  }
  return context;
};
