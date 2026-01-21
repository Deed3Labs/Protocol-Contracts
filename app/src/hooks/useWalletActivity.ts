import { useState, useEffect, useMemo } from 'react';
import { useAppKitAccount, useAppKitProvider, useAppKitNetwork } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { formatDistanceToNow } from 'date-fns';
import { getNetworkByChainId, getNetworkInfo, getRpcUrlForNetwork } from '@/config/networks';

export interface WalletTransaction {
  id: string;
  type: 'buy' | 'sell' | 'deposit' | 'withdraw' | 'mint' | 'trade' | 'transfer' | 'contract';
  assetSymbol: string;
  assetName?: string;
  amount: number;
  currency: string;
  date: string;
  status: 'completed' | 'pending' | 'failed';
  hash?: string;
  from?: string;
  to?: string;
  timestamp?: number;
}

interface UseWalletActivityReturn {
  transactions: WalletTransaction[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  blockExplorerUrl: string; // Block explorer URL for the current network
  currencySymbol: string; // Native currency symbol for the current network
}

/**
 * Hook to fetch wallet transaction history
 * This fetches recent transactions from the blockchain
 */
export function useWalletActivity(limit: number = 20): UseWalletActivityReturn {
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider("eip155");
  const { caipNetworkId } = useAppKitNetwork();
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get network info for native currency and block explorer
  const chainId = useMemo(() => {
    return caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  }, [caipNetworkId]);

  // Memoize network config for return value
  const networkConfig = useMemo(() => {
    return chainId ? getNetworkByChainId(chainId) : null;
  }, [chainId]);

  const networkInfo = useMemo(() => {
    return chainId ? getNetworkInfo(chainId) : null;
  }, [chainId]);

  const currencySymbol = useMemo(() => {
    return networkConfig?.nativeCurrency.symbol || networkInfo?.nativeCurrency.symbol || 'ETH';
  }, [networkConfig, networkInfo]);

  const blockExplorerUrl = useMemo(() => {
    return networkConfig?.blockExplorer || networkInfo?.blockExplorer || 'https://basescan.org';
  }, [networkConfig, networkInfo]);

  const fetchTransactions = async () => {
    if (!isConnected || !address) {
      setTransactions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let provider: ethers.Provider;

      // Try to use AppKit provider first
      if (walletProvider) {
        provider = walletProvider as unknown as ethers.Provider;
      } else if (window.ethereum) {
        provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
      } else {
        // Fallback to RPC provider using network config
        if (!chainId) {
          throw new Error('No chain ID available');
        }
        
        const rpcUrl = getRpcUrlForNetwork(chainId);
        if (!rpcUrl) {
          throw new Error(`No RPC URL available for chain ${chainId}`);
        }
        
        provider = new ethers.JsonRpcProvider(rpcUrl);
      }

      // Fetch transaction history
      // Note: This is a simplified version. For production, you might want to use:
      // - A blockchain explorer API (like Etherscan, Basescan) - RECOMMENDED
      // - TheGraph or similar indexing service
      // - Your own backend that indexes transactions
      
      // For now, we'll use a lightweight approach that checks recent blocks
      // This is not ideal for production but works for demo purposes
      const blockNumber = await provider.getBlockNumber();
      const parsedTransactions: WalletTransaction[] = [];

      // Limit blocks to check to avoid performance issues
      // In production, use an indexer API instead
      const blocksToCheck = Math.min(limit * 3, 50);
      
      // Check blocks in batches to avoid overwhelming the provider
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
                  
                  // Type guard: skip transaction hashes (strings)
                  if (typeof tx === 'string') continue;
                  
                  // At this point, TypeScript knows tx is a TransactionResponse
                  // But we need to assert it explicitly for type safety
                  const transaction = tx as ethers.TransactionResponse;
                  
                  // Check if transaction is from or to our address
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
                        id: transaction.hash,
                        type: isFromAddress 
                          ? (value > 0 ? 'withdraw' : transaction.to ? 'transfer' : 'contract')
                          : (value > 0 ? 'deposit' : 'transfer'),
                        assetSymbol: currencySymbol, // Use network's native currency
                        amount: value,
                        currency: currencySymbol,
                        date,
                        status,
                        hash: transaction.hash,
                        from: transaction.from,
                        to: transaction.to || undefined,
                        timestamp
                      });
                      
                      foundCount++;
                    } catch (receiptError) {
                      // Skip if receipt fetch fails
                      console.warn(`Failed to fetch receipt for ${transaction.hash}:`, receiptError);
                    }
                  }
                }
              } catch (blockError) {
                // Skip blocks that fail to fetch
                console.warn(`Failed to fetch block ${blockNumber - i}:`, blockError);
              }
            })()
          );
        }
        
        await Promise.all(batchPromises);
      }

      // Sort by timestamp (newest first)
      parsedTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      setTransactions(parsedTransactions);
    } catch (err) {
      console.error('Error fetching wallet activity:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch transactions');
      setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchTransactions, 30000);
    
    return () => clearInterval(interval);
  }, [address, isConnected, walletProvider, caipNetworkId, limit]);

  return {
    transactions,
    isLoading,
    error,
    refresh: fetchTransactions,
    blockExplorerUrl,
    currencySymbol
  };
}
