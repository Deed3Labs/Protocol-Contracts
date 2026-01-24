import { useState, useCallback, useMemo } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { SUPPORTED_NETWORKS } from '@/config/networks';
import { getNFTs } from '@/utils/apiClient';
import { withTimeout, fetchWithDeviceOptimization } from './utils/multichainHelpers';

export interface GeneralNFT {
  tokenId: string;
  owner: string;
  contractAddress: string;
  uri: string;
  name?: string;
  symbol?: string;
  priceUSD?: number;
  standard: 'ERC721' | 'ERC1155';
  amount?: string; // For ERC1155: quantity owned
  chainId: number;
  chainName: string;
}

interface UseGeneralNFTsReturn {
  nfts: GeneralNFT[];
  totalCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshContract: (chainId: number, contractAddress: string) => Promise<void>;
}

/**
 * Hook to fetch general ERC721/ERC1155 NFTs from arbitrary contracts
 * 
 * Fetches NFTs from specified contract addresses across all configured chains.
 * Uses server API with Redis caching - server is required in production.
 * 
 * @param contractAddresses - Array of { chainId, contractAddress } to fetch NFTs from
 * 
 * @example
 * ```tsx
 * const { nfts, totalCount, refresh } = useGeneralNFTs([
 *   { chainId: 84532, contractAddress: '0x1234...' },
 *   { chainId: 1, contractAddress: '0x5678...' }
 * ]);
 * 
 * // Display NFTs
 * nfts.forEach(nft => {
 *   console.log(`${nft.name || 'NFT'} #${nft.tokenId} on ${nft.chainName}`);
 * });
 * ```
 * 
 * @returns Object containing:
 * - `nfts`: Array of GeneralNFT objects with chain information
 * - `totalCount`: Total number of NFTs across all contracts
 * - `isLoading`: Whether data is currently loading
 * - `error`: Error message, if any
 * - `refresh`: Function to refresh all contracts
 * - `refreshContract`: Function to refresh a specific contract
 */
export function useGeneralNFTs(
  contractAddresses: Array<{ chainId: number; contractAddress: string }>
): UseGeneralNFTsReturn {
  const { address, isConnected } = useAppKitAccount();
  const [nfts, setNfts] = useState<GeneralNFT[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch NFTs for a specific contract
  const fetchContractNFTs = useCallback(async (
    chainId: number,
    contractAddress: string
  ): Promise<GeneralNFT[]> => {
    if (!address) return [];

    const networkConfig = SUPPORTED_NETWORKS.find(n => n.chainId === chainId);
    if (!networkConfig) return [];

    if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
      return [];
    }

    try {
      // Use server API (with Redis caching)
      // Pass type=general to indicate we want general NFTs, not T-Deeds
      const serverNFTs = await withTimeout(
        getNFTs(chainId, address, contractAddress, 'general'),
        5000 // 5 second timeout for production
      ) as Awaited<ReturnType<typeof getNFTs>> | null;
      
      if (!serverNFTs || !serverNFTs.nfts) {
        // No NFTs found or server error
        if (import.meta.env.PROD && !serverNFTs) {
          console.error(`[useGeneralNFTs] Server API failed for chain ${chainId}, contract ${contractAddress}`);
        }
        return [];
      }

      // Map server response to GeneralNFT format
      return serverNFTs.nfts.map((nft: any) => ({
        tokenId: nft.tokenId,
        owner: nft.owner,
        contractAddress: nft.contractAddress,
        uri: nft.uri,
        name: nft.name,
        symbol: nft.symbol,
        priceUSD: nft.priceUSD,
        standard: nft.standard || 'ERC721', // Default to ERC721 if not specified
        amount: nft.amount || '1', // Default to 1 for ERC721
        chainId,
        chainName: networkConfig.name,
      }));
    } catch (err) {
      // Server is required in production
      if (import.meta.env.PROD) {
        console.error(`[useGeneralNFTs] Server API error for chain ${chainId}, contract ${contractAddress}:`, err);
        throw new Error(`Server API is required but unavailable for chain ${chainId}`);
      }
      // In development, return empty array
      return [];
    }
  }, [address]);

  // Refresh a specific contract
  const refreshContract = useCallback(async (chainId: number, contractAddress: string) => {
    if (!isConnected || !address) return;

    const contractNFTs = await fetchContractNFTs(chainId, contractAddress);
    setNfts(prev => {
      // Remove old NFTs from this contract and add new ones
      const filtered = prev.filter(n => 
        !(n.chainId === chainId && n.contractAddress.toLowerCase() === contractAddress.toLowerCase())
      );
      return [...filtered, ...contractNFTs];
    });
  }, [isConnected, address, fetchContractNFTs]);

  // Refresh all contracts
  const refresh = useCallback(async () => {
    if (!isConnected || !address || contractAddresses.length === 0) {
      setNfts([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Capture previous NFTs to preserve during refresh
    let previousNFTs: GeneralNFT[] = [];
    setNfts(prev => {
      previousNFTs = prev;
      // Keep previous NFTs visible while loading (don't clear them)
      return prev;
    });

    try {
      console.log('[useGeneralNFTs] Refreshing general NFTs for address:', address, 'contracts:', contractAddresses.length);
      // Use device-optimized fetching (sequential for mobile, parallel for desktop)
      const allNFTs = await fetchWithDeviceOptimization(
        contractAddresses,
        async (contract) => await fetchContractNFTs(contract.chainId, contract.contractAddress)
      );
      console.log('[useGeneralNFTs] Fetched general NFTs:', allNFTs.length);
      // Only update with new data - this prevents clearing to empty array during refresh
      setNfts(allNFTs);
    } catch (err) {
      console.error('[useGeneralNFTs] Error fetching general NFTs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch NFTs');
      // On error, restore previous NFTs to prevent UI from showing empty state
      if (previousNFTs.length > 0) {
        setNfts(previousNFTs);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, contractAddresses, fetchContractNFTs]);

  // Note: Auto-fetch is handled by PortfolioContext to avoid duplicate requests
  // This hook only fetches when refresh() or refreshContract() is explicitly called

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
    refreshContract,
  };
}
