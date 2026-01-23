import { useState, useCallback, useMemo } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { SUPPORTED_NETWORKS, getContractAddressForNetwork } from '@/config/networks';
import type { DeedNFT } from '@/context/DeedNFTContext';
import { getNFTs } from '@/utils/apiClient';
import { withTimeout, fetchWithDeviceOptimization } from './utils/multichainHelpers';

export interface MultichainDeedNFT extends DeedNFT {
  chainId: number;
  chainName: string;
}

interface UseMultichainDeedNFTsReturn {
  nfts: MultichainDeedNFT[];
  totalCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshChain: (chainId: number) => Promise<void>;
}


/**
 * Hook to fetch DeedNFTs across all supported networks
 * 
 * Fetches DeedNFT tokens owned by the connected wallet across all configured chains.
 * Uses server API with Redis caching - server is required in production.
 * 
 * @example
 * ```tsx
 * const { nfts, totalCount, refresh } = useMultichainDeedNFTs();
 * 
 * // Display NFTs
 * nfts.forEach(nft => {
 *   console.log(`${nft.definition} on ${nft.chainName} (Token ID: ${nft.tokenId})`);
 * });
 * ```
 * 
 * @returns Object containing:
 * - `nfts`: Array of DeedNFT objects with chain information
 * - `totalCount`: Total number of NFTs across all chains
 * - `isLoading`: Whether data is currently loading
 * - `error`: Error message, if any
 * - `refresh`: Function to refresh all chains
 * - `refreshChain`: Function to refresh a specific chain
 */
export function useMultichainDeedNFTs(): UseMultichainDeedNFTsReturn {
  const { address, isConnected } = useAppKitAccount();
  const [nfts, setNfts] = useState<MultichainDeedNFT[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);


  // Fetch NFTs for a specific chain
  const fetchChainNFTs = useCallback(async (chainId: number): Promise<MultichainDeedNFT[]> => {
    if (!address) return [];

    const networkConfig = SUPPORTED_NETWORKS.find(n => n.chainId === chainId);
    if (!networkConfig) return [];

    const contractAddress = getContractAddressForNetwork(chainId);
    if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
      // Contract not deployed on this chain
      return [];
    }

    try {
      // Use server API (with Redis caching)
      const serverNFTs = await withTimeout(
        getNFTs(chainId, address, contractAddress),
        5000 // 5 second timeout for production
      ) as Awaited<ReturnType<typeof getNFTs>> | null;
      
      if (!serverNFTs || !serverNFTs.nfts) {
        // No NFTs found or server error
        if (import.meta.env.PROD && !serverNFTs) {
          console.error(`[useMultichainDeedNFTs] Server API failed for chain ${chainId}`);
        }
        return [];
      }

      // Map server response to MultichainDeedNFT format
      return serverNFTs.nfts.map((nft: any) => ({
        ...nft,
        chainId,
        chainName: networkConfig.name,
      }));
    } catch (err) {
      // Server is required in production
      if (import.meta.env.PROD) {
        console.error(`[useMultichainDeedNFTs] Server API error for chain ${chainId}:`, err);
        throw new Error(`Server API is required but unavailable for chain ${chainId}`);
      }
      // In development, return empty array
      return [];
    }
  }, [address]);

  // Refresh a specific chain
  const refreshChain = useCallback(async (chainId: number) => {
    if (!isConnected || !address) return;

    const chainNFTs = await fetchChainNFTs(chainId);
    setNfts(prev => {
      // Remove old NFTs from this chain and add new ones
      const filtered = prev.filter(n => n.chainId !== chainId);
      return [...filtered, ...chainNFTs];
    });
  }, [isConnected, address, fetchChainNFTs]);

  // Refresh all chains
  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setNfts([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use device-optimized fetching (sequential for mobile, parallel for desktop)
      const allNFTs = await fetchWithDeviceOptimization(
        SUPPORTED_NETWORKS,
        async (network) => await fetchChainNFTs(network.chainId)
      );
      setNfts(allNFTs);
    } catch (err) {
      // Silent error handling
      setError(err instanceof Error ? err.message : 'Failed to fetch NFTs');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, fetchChainNFTs]);

  // Note: Auto-fetch is handled by PortfolioContext to avoid duplicate requests
  // This hook only fetches when refresh() or refreshChain() is explicitly called

  // Calculate total count
  const totalCount = useMemo(() => {
    return nfts.length;
  }, [nfts]);

  return {
    nfts,
    totalCount,
    isLoading,
    error,
    refresh,
    refreshChain,
  };
}
