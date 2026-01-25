import { useState, useCallback, useMemo } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { SUPPORTED_NETWORKS, getContractAddressForNetwork } from '@/config/networks';
import type { DeedNFT } from '@/context/DeedNFTContext';
import { getNFTs, getNFTsByAddressPortfolio } from '@/utils/apiClient';
import { ethers } from 'ethers';

export interface MultichainDeedNFT extends DeedNFT {
  chainId: number;
  chainName: string;
  priceUSD?: number; // Optional: price from OpenSea or other sources
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
 * Uses Alchemy Portfolio API (get-nfts-by-address) for optimized multi-chain fetching.
 * Server API with Redis caching - server is required in production.
 * 
 * Optimization: Uses Portfolio API endpoint directly to fetch NFTs across all chains
 * in a single request (or batched if >15 chains) instead of making individual requests
 * per chain. This significantly reduces API calls and improves performance.
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


  /**
   * Convert Portfolio API NFT format to DeedNFT format
   * Extracts T-Deed metadata from Portfolio API attributes
   */
  const convertPortfolioNFTToDeedNFT = useCallback((
    nft: any,
    chainId: number,
    chainName: string,
    contractAddress: string
  ): MultichainDeedNFT | null => {
    // Filter by contract address
    const nftContract = (nft.contract?.address || '').toLowerCase();
    if (nftContract !== contractAddress.toLowerCase()) {
      return null;
    }

    const tokenId = nft.tokenId;
    if (!tokenId) return null;

    // Extract data from Portfolio API response
    const tokenURI = nft.tokenUri || nft.raw?.tokenUri || '';
    const description = nft.description || nft.raw?.metadata?.description || '';
    const attributes = nft.raw?.metadata?.attributes || [];

    // Map asset type string to number (from MetadataRenderer contract)
    const assetTypeMap: Record<string, number> = {
      'Land': 0,
      'Vehicle': 1,
      'Estate': 2,
      'CommercialEquipment': 3,
    };

    // Parse attributes to extract T-Deed specific data
    let assetType = 0;
    let validatorAddress = ethers.ZeroAddress;
    let configuration = '';

    for (const attr of attributes || []) {
      const traitType = attr.trait_type || '';
      const traitTypeLower = traitType.toLowerCase();
      const value = attr.value;

      // Match trait names from DeedNFT contract (case-insensitive)
      if (traitTypeLower === 'asset type' || traitTypeLower === 'assettype') {
        if (typeof value === 'string') {
          assetType = assetTypeMap[value] ?? 0;
        } else if (typeof value === 'number') {
          assetType = value;
        }
      } else if (traitTypeLower === 'validator') {
        try {
          if (typeof value === 'string' && value.startsWith('0x')) {
            validatorAddress = ethers.getAddress(value);
          }
        } catch {
          // Invalid address format
        }
      } else if (traitTypeLower === 'configuration') {
        if (typeof value === 'string') {
          configuration = value;
        }
      }
    }

    // Definition comes from description field
    const definition = description || `T-Deed #${tokenId}`;

    // Get price from OpenSea metadata if available
    const priceUSD = nft.contract?.openseaMetadata?.floorPrice;

    return {
      tokenId: tokenId.toString(),
      owner: address || '',
      assetType,
      uri: tokenURI,
      definition,
      configuration,
      validatorAddress,
      token: ethers.ZeroAddress, // Will be fetched via RPC if needed
      salt: '0', // Will be fetched via RPC if needed
      isMinted: true,
      chainId,
      chainName,
      priceUSD,
    };
  }, [address]);

  // Fetch NFTs for a specific chain (fallback for refreshChain)
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
      // Explicitly pass type='t-deed' to ensure we fetch T-Deeds, not general NFTs
      const serverNFTs = await getNFTs(chainId, address, contractAddress, 't-deed');
      
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

  // Refresh all chains using Portfolio API (optimized - single request for all chains)
  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setNfts([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Capture previous NFTs to preserve during refresh
    // Note: On initial load (prev.length === 0), this returns [] which is correct
    // - Loading states will still show because they check length === 0
    // - Only after initial load does this preserve data to prevent UI flashing
    let previousNFTs: MultichainDeedNFT[] = [];
    setNfts(prev => {
      previousNFTs = prev;
      // Keep previous NFTs visible while loading (don't clear them)
      // If prev is empty (initial load), it stays empty - loading states will show
      return prev;
    });

    try {
      console.log('[useMultichainDeedNFTs] Refreshing T-Deeds for address:', address);
      
      // Get all chains with T-Deed contracts
      const chainsWithContracts = SUPPORTED_NETWORKS
        .filter(network => {
          const contractAddress = getContractAddressForNetwork(network.chainId);
          return contractAddress && contractAddress !== '0x0000000000000000000000000000000000000000';
        })
        .map(network => network.chainId);

      if (chainsWithContracts.length === 0) {
        console.log('[useMultichainDeedNFTs] No chains with T-Deed contracts found');
        setNfts([]);
        setIsLoading(false);
        return;
      }

      // Portfolio API limits: max 2 addresses, 15 networks per address
      // Split into batches if needed
      const maxNetworksPerRequest = 15;
      const batches: number[][] = [];
      for (let i = 0; i < chainsWithContracts.length; i += maxNetworksPerRequest) {
        batches.push(chainsWithContracts.slice(i, i + maxNetworksPerRequest));
      }

      const allNFTs: MultichainDeedNFT[] = [];

      // Fetch all batches using Portfolio API
      for (const batchChainIds of batches) {
        const portfolioResult = await getNFTsByAddressPortfolio(
          [{ address, chainIds: batchChainIds }],
          {
            withMetadata: true,
            excludeFilters: ['SPAM'], // Filter out spam NFTs
          }
        );

        if (portfolioResult && portfolioResult.results) {
          for (const result of portfolioResult.results) {
            if (!result.nfts || result.nfts.length === 0) continue;

            const networkConfig = SUPPORTED_NETWORKS.find(n => n.chainId === result.chainId);
            if (!networkConfig) continue;

            const contractAddress = getContractAddressForNetwork(result.chainId);
            if (!contractAddress) continue;

            // Convert Portfolio API NFTs to DeedNFT format
            for (const nft of result.nfts) {
              const deedNFT = convertPortfolioNFTToDeedNFT(
                nft,
                result.chainId,
                networkConfig.name,
                contractAddress
              );

              if (deedNFT) {
                allNFTs.push(deedNFT);
              }
            }
          }
        }
      }

      console.log('[useMultichainDeedNFTs] Fetched T-Deeds via Portfolio API:', allNFTs.length);
      // Only update with new data - this prevents clearing to empty array during refresh
      setNfts(allNFTs);
    } catch (err) {
      console.error('[useMultichainDeedNFTs] Error fetching T-Deeds:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch NFTs');
      // On error, restore previous NFTs to prevent UI from showing empty state
      if (previousNFTs.length > 0) {
        setNfts(previousNFTs);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, convertPortfolioNFTToDeedNFT]);

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
