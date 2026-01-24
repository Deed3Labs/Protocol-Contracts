import { useState, useCallback, useMemo } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { SUPPORTED_NETWORKS } from '@/config/networks';
import { getNFTs, getNFTsByAddressPortfolio } from '@/utils/apiClient';
import { withTimeout, fetchWithDeviceOptimization } from './utils/multichainHelpers';

/**
 * Map chain ID to Alchemy network identifier
 */
function getAlchemyNetworkName(chainId: number): string {
  const networkMap: Record<number, string> = {
    1: 'eth-mainnet',
    8453: 'base-mainnet',
    137: 'polygon-mainnet',
    42161: 'arb-mainnet',
    100: 'gnosis-mainnet',
    11155111: 'eth-sepolia',
    84532: 'base-sepolia',
    80001: 'polygon-mumbai',
  };
  return networkMap[chainId] || `chain-${chainId}`;
}

/**
 * General NFT - Portfolio API format with chain info
 * Based on Alchemy Portfolio API format for richer data
 */
export interface GeneralNFT {
  // Portfolio API fields
  network: string; // Network identifier (e.g., "eth-mainnet")
  address: string; // Wallet address
  contract: {
    address: string;
    name?: string;
    symbol?: string;
    totalSupply?: string;
    tokenType: 'ERC721' | 'ERC1155' | 'NO_SUPPORTED_NFT_STANDARD' | 'NOT_A_CONTRACT';
    contractDeployer?: string;
    deployedBlockNumber?: number;
    openseaMetadata?: {
      floorPrice?: number;
      collectionName?: string;
      imageUrl?: string;
      description?: string;
      externalUrl?: string;
      twitterUsername?: string;
      discordUrl?: string;
      bannerImageUrl?: string;
    };
    isSpam?: string;
    spamClassifications?: string[];
  };
  tokenId: string;
  tokenType?: string;
  name?: string;
  description?: string;
  image?: {
    cachedUrl?: string;
    thumbnailUrl?: string;
    pngUrl?: string;
    contentType?: string;
    size?: number;
    originalUrl?: string;
  };
  raw?: {
    tokenUri?: string;
    metadata?: {
      image?: string;
      name?: string;
      description?: string;
      attributes?: Array<{
        trait_type?: string;
        value?: string;
      }>;
    };
    error?: string;
  };
  collection?: {
    name?: string;
    slug?: string;
    externalUrl?: string;
    bannerImageUrl?: string;
  };
  tokenUri?: string;
  timeLastUpdated?: string;
  acquiredAt?: {
    blockTimestamp?: string;
    blockNumber?: string;
  };
  
  // Additional fields for compatibility
  chainId: number; // Chain ID (derived from network)
  chainName: string; // Chain name (derived from network)
  
  // Computed convenience fields
  owner?: string; // Wallet address (from address field)
  contractAddress?: string; // Contract address (from contract.address)
  uri?: string; // Token URI (from tokenUri or raw.tokenUri)
  symbol?: string; // Collection symbol (from contract.symbol)
  priceUSD?: number; // Floor price (from contract.openseaMetadata.floorPrice)
  standard?: 'ERC721' | 'ERC1155'; // Token standard (from contract.tokenType)
  amount?: string; // Quantity owned (defaults to "1")
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

      // Map server response to Portfolio API format
      const networkName = getAlchemyNetworkName(chainId);
      return serverNFTs.nfts.map((nft: any) => ({
        // Portfolio API format
        network: networkName,
        address: address.toLowerCase(),
        contract: {
          address: nft.contractAddress,
          name: nft.name,
          symbol: nft.symbol,
          tokenType: (nft.standard || 'ERC721') as 'ERC721' | 'ERC1155',
        },
        tokenId: nft.tokenId,
        name: nft.name,
        tokenUri: nft.uri,
        // Additional fields
        chainId,
        chainName: networkConfig.name,
        // Computed convenience fields
        owner: address.toLowerCase(),
        contractAddress: nft.contractAddress,
        uri: nft.uri,
        symbol: nft.symbol,
        priceUSD: nft.priceUSD,
        standard: nft.standard || 'ERC721',
        amount: nft.amount || '1',
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
        !(n.chainId === chainId && (n.contractAddress || n.contract?.address || '').toLowerCase() === contractAddress.toLowerCase())
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
      return prev;
    });

    try {
      console.log('[useGeneralNFTs] Refreshing general NFTs for address:', address, 'contracts:', contractAddresses.length);
      
      // Use Portfolio API when fetching multiple chains (more efficient)
      // Group contracts by chain to use Portfolio API
      const chainsWithContracts = new Map<number, string[]>();
      contractAddresses.forEach(({ chainId, contractAddress }) => {
        if (!chainsWithContracts.has(chainId)) {
          chainsWithContracts.set(chainId, []);
        }
        chainsWithContracts.get(chainId)!.push(contractAddress);
      });

      const uniqueChainIds = Array.from(chainsWithContracts.keys());

      // Use Portfolio API if we have multiple chains
      if (uniqueChainIds.length > 1) {
        try {
          // Portfolio API limits: max 2 addresses, 15 networks per address
          // Split into batches if needed
          const maxNetworksPerRequest = 15;
          const batches: number[][] = [];
          for (let i = 0; i < uniqueChainIds.length; i += maxNetworksPerRequest) {
            batches.push(uniqueChainIds.slice(i, i + maxNetworksPerRequest));
          }

          const allNFTs: GeneralNFT[] = [];

          for (const batchChainIds of batches) {
            const portfolioResult = await withTimeout(
              getNFTsByAddressPortfolio(
                [{ address, chainIds: batchChainIds }],
                {
                  withMetadata: true,
                  excludeFilters: ['SPAM'], // Filter out spam NFTs
                }
              ),
              90000 // 90 second timeout
            );

            if (portfolioResult && portfolioResult.results) {
              for (const result of portfolioResult.results) {
                if (result.nfts && result.nfts.length > 0) {
                  const networkConfig = SUPPORTED_NETWORKS.find(n => n.chainId === result.chainId);
                  if (!networkConfig) continue;

                  // Filter NFTs by contract addresses we're interested in
                  const contractAddressesForChain = chainsWithContracts.get(result.chainId) || [];
                  const contractAddressesLower = contractAddressesForChain.map(addr => addr.toLowerCase());

                  for (const nft of result.nfts) {
                    // Skip if not a supported NFT standard
                    if (nft.contract.tokenType === 'NO_SUPPORTED_NFT_STANDARD' || 
                        nft.contract.tokenType === 'NOT_A_CONTRACT') {
                      continue;
                    }

                    // Filter by contract address if specified
                    const nftContractAddress = (nft.contract?.address || '').toLowerCase();
                    if (contractAddressesLower.length > 0 && !contractAddressesLower.includes(nftContractAddress)) {
                      continue;
                    }

                    // Return Portfolio API format with computed convenience fields
                    allNFTs.push({
                      ...nft, // Portfolio API format
                      chainId: result.chainId,
                      chainName: networkConfig.name,
                      // Computed convenience fields
                      owner: nft.address.toLowerCase(),
                      contractAddress: nftContractAddress,
                      uri: nft.tokenUri || nft.raw?.tokenUri || '',
                      symbol: nft.contract.symbol,
                      priceUSD: nft.contract.openseaMetadata?.floorPrice,
                      standard: nft.contract.tokenType === 'ERC1155' ? 'ERC1155' : 'ERC721',
                      amount: '1', // Portfolio API doesn't return quantity for ERC1155 in this format
                    });
                  }
                }
              }
            }
          }

          if (allNFTs.length > 0) {
            console.log('[useGeneralNFTs] Fetched general NFTs via Portfolio API:', allNFTs.length);
            setNfts(allNFTs);
            setIsLoading(false);
            return;
          }
        } catch (portfolioError) {
          // Portfolio API failed, fall back to old method
          console.warn('[useGeneralNFTs] Portfolio API failed, falling back to old method:', portfolioError);
        }
      }

      // Fallback to old method (single chain or Portfolio API failed)
      const allNFTs = await fetchWithDeviceOptimization(
        contractAddresses,
        async (contract) => await fetchContractNFTs(contract.chainId, contract.contractAddress)
      );
      console.log('[useGeneralNFTs] Fetched general NFTs via old method:', allNFTs.length);
      setNfts(allNFTs);
    } catch (err) {
      console.error('[useGeneralNFTs] Error fetching general NFTs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch NFTs');
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
