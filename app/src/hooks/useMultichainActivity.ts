import { useState, useEffect, useCallback } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { formatDistanceToNow } from 'date-fns';
import { SUPPORTED_NETWORKS, getRpcUrlForNetwork, getNetworkByChainId, getNetworkInfo } from '@/config/networks';
import { getEthereumProvider } from '@/utils/providerUtils';
import type { WalletTransaction } from './useWalletActivity';

export interface MultichainTransaction extends WalletTransaction {
  chainId: number;
  chainName: string;
}

interface UseMultichainActivityReturn {
  transactions: MultichainTransaction[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshChain: (chainId: number) => Promise<void>;
}

/**
 * Hook to fetch wallet transaction history across all supported networks
 */
export function useMultichainActivity(limit: number = 20): UseMultichainActivityReturn {
  const { address, isConnected } = useAppKitAccount();
  const [transactions, setTransactions] = useState<MultichainTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get provider for a specific chain
  const getChainProvider = useCallback(async (chainId: number): Promise<ethers.Provider> => {
    try {
      const provider = await getEthereumProvider();
      const network = await provider.getNetwork();
      
      if (network.chainId === BigInt(chainId)) {
        return provider;
      }
    } catch (error) {
      // Fall through to RPC provider
    }

    const rpcUrl = getRpcUrlForNetwork(chainId);
    if (!rpcUrl) {
      throw new Error(`No RPC URL available for chain ${chainId}`);
    }
    return new ethers.JsonRpcProvider(rpcUrl);
  }, []);

  // Fetch transactions for a specific chain
  const fetchChainTransactions = useCallback(async (chainId: number): Promise<MultichainTransaction[]> => {
    if (!address) return [];

    const networkConfig = getNetworkByChainId(chainId);
    const networkInfo = getNetworkInfo(chainId);
    const currencySymbol = networkConfig?.nativeCurrency.symbol || networkInfo?.nativeCurrency.symbol || 'ETH';

    try {
      const provider = await getChainProvider(chainId);
      const blockNumber = await provider.getBlockNumber();
      const parsedTransactions: MultichainTransaction[] = [];

      // Limit blocks to check
      const blocksToCheck = Math.min(limit * 3, 50);
      const batchSize = 10;
      let foundCount = 0;

      for (let batchStart = 0; batchStart < blocksToCheck && foundCount < limit; batchStart += batchSize) {
        const batchPromises: Promise<void>[] = [];

        for (let i = batchStart; i < Math.min(batchStart + batchSize, blocksToCheck) && foundCount < limit; i++) {
          batchPromises.push(
            (async () => {
              try {
                const block = await provider.getBlock(blockNumber - i, true);
                if (!block || !block.transactions) return;

                for (const tx of block.transactions) {
                  if (foundCount >= limit) return;

                  if (typeof tx === 'string') continue;

                  const transaction = tx as ethers.TransactionResponse;
                  const isFromAddress = transaction.from?.toLowerCase() === address.toLowerCase();
                  const isToAddress = transaction.to?.toLowerCase() === address.toLowerCase();

                  if (isFromAddress || isToAddress) {
                    try {
                      const receipt = await provider.getTransactionReceipt(transaction.hash);
                      const status = receipt?.status === 1 ? 'completed' : receipt?.status === 0 ? 'failed' : 'pending';

                      const value = transaction.value ? parseFloat(ethers.formatEther(transaction.value)) : 0;
                      const timestamp = block.timestamp ? Number(block.timestamp) * 1000 : Date.now();
                      const date = formatDistanceToNow(new Date(timestamp), { addSuffix: true });

                      parsedTransactions.push({
                        id: `${chainId}-${transaction.hash}`,
                        type: isFromAddress
                          ? (value > 0 ? 'withdraw' : transaction.to ? 'transfer' : 'contract')
                          : (value > 0 ? 'deposit' : 'transfer'),
                        assetSymbol: currencySymbol,
                        amount: value,
                        currency: currencySymbol,
                        date,
                        status,
                        hash: transaction.hash,
                        from: transaction.from,
                        to: transaction.to || undefined,
                        timestamp,
                        chainId,
                        chainName: networkConfig?.name || networkInfo?.name || `Chain ${chainId}`,
                      });

                      foundCount++;
                    } catch (receiptError) {
                      console.warn(`Failed to fetch receipt for ${transaction.hash}:`, receiptError);
                    }
                  }
                }
              } catch (blockError) {
                console.warn(`Failed to fetch block ${blockNumber - i}:`, blockError);
              }
            })()
          );
        }

        await Promise.all(batchPromises);
      }

      // Sort by timestamp (newest first)
      parsedTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return parsedTransactions;
    } catch (err) {
      console.error(`Error fetching transactions for chain ${chainId}:`, err);
      return [];
    }
  }, [address, getChainProvider, limit]);

  // Refresh a specific chain
  const refreshChain = useCallback(async (chainId: number) => {
    if (!isConnected || !address) return;

    const chainTransactions = await fetchChainTransactions(chainId);
    setTransactions(prev => {
      // Remove old transactions from this chain and add new ones
      const filtered = prev.filter(t => t.chainId !== chainId);
      const merged = [...filtered, ...chainTransactions];
      // Sort by timestamp (newest first)
      return merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    });
  }, [isConnected, address, fetchChainTransactions]);

  // Refresh all chains
  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setTransactions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch all chains in parallel
      const transactionPromises = SUPPORTED_NETWORKS.map(network => fetchChainTransactions(network.chainId));
      const results = await Promise.all(transactionPromises);
      const allTransactions = results.flat();
      
      // Sort by timestamp (newest first) and limit
      allTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setTransactions(allTransactions.slice(0, limit));
    } catch (err) {
      console.error('Error fetching multichain activity:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch transactions');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, fetchChainTransactions, limit]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh every 30 seconds
  useEffect(() => {
    if (!isConnected || !address) return;

    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [isConnected, address, refresh]);

  return {
    transactions,
    isLoading,
    error,
    refresh,
    refreshChain,
  };
}
