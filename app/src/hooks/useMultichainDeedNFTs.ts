import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { SUPPORTED_NETWORKS, getRpcUrlForNetwork, getContractAddressForNetwork, getAbiPathForNetwork } from '@/config/networks';
import { getEthereumProvider } from '@/utils/providerUtils';
import type { DeedNFT } from '@/context/DeedNFTContext';

// Detect mobile device
const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

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

// Dynamic ABI loading function
const getDeedNFTAbi = async (chainId: number) => {
  try {
    const abiPath = getAbiPathForNetwork(chainId, 'DeedNFT');
    const abiModule = await import(abiPath);
    return JSON.parse(abiModule.default.abi);
  } catch (error) {
    console.error('Error loading DeedNFT ABI:', error);
    const fallbackModule = await import('@/contracts/base-sepolia/DeedNFT.json');
    return JSON.parse(fallbackModule.default.abi);
  }
};

/**
 * Hook to fetch DeedNFTs across all supported networks
 */
export function useMultichainDeedNFTs(): UseMultichainDeedNFTsReturn {
  const { address, isConnected } = useAppKitAccount();
  const [nfts, setNfts] = useState<MultichainDeedNFT[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get provider for a specific chain
  const getChainProvider = useCallback(async (chainId: number): Promise<ethers.Provider> => {
    try {
      // On mobile, add a small delay
      if (isMobileDevice()) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }

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
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    if (isMobileDevice()) {
      (provider as any).connection = {
        ...(provider as any).connection,
        timeout: 10000,
      };
    }
    
    return provider;
  }, []);

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
      const provider = await getChainProvider(chainId);
      const abi = await getDeedNFTAbi(chainId);
      const contract = new ethers.Contract(contractAddress, abi, provider);

      // Get total supply
      const totalSupply = await contract.totalSupply().catch(() => 0n);
      if (totalSupply === 0n) return [];

      // Get all token IDs owned by the user
      const userNFTs: MultichainDeedNFT[] = [];
      
      // Check tokens in batches (to avoid overwhelming the provider)
      const batchSize = 50;
      const maxTokens = Number(totalSupply);
      
      for (let i = 0; i < Math.min(maxTokens, 1000); i += batchSize) {
        const batchPromises: Promise<void>[] = [];
        
        for (let j = i; j < Math.min(i + batchSize, maxTokens); j++) {
          batchPromises.push(
            (async () => {
              try {
                const tokenId = j.toString();
                const owner = await contract.ownerOf(tokenId).catch(() => null);
                
                if (owner && owner.toLowerCase() === address.toLowerCase()) {
                  // Get token URI and other data
                  const uri = await contract.tokenURI(tokenId).catch(() => '');
                  
                  // Parse metadata from URI if available
                  let definition = '';
                  let configuration = '';
                  let assetType = 0;
                  
                  if (uri) {
                    try {
                      const response = await fetch(uri);
                      const metadata = await response.json();
                      definition = metadata.definition || '';
                      configuration = metadata.configuration || '';
                      assetType = metadata.assetType || 0;
                    } catch (e) {
                      console.warn(`Failed to fetch metadata for token ${tokenId}:`, e);
                    }
                  }

                  userNFTs.push({
                    tokenId,
                    owner: owner,
                    assetType,
                    uri,
                    definition,
                    configuration,
                    validatorAddress: await contract.validator(tokenId).catch(() => ''),
                    token: await contract.token(tokenId).catch(() => ''),
                    salt: await contract.salt(tokenId).catch(() => ''),
                    isMinted: true,
                    chainId,
                    chainName: networkConfig.name,
                  });
                }
              } catch (err) {
                // Token doesn't exist or other error - skip
              }
            })()
          );
        }
        
        await Promise.all(batchPromises);
      }

      return userNFTs;
    } catch (err) {
      console.error(`Error fetching NFTs for chain ${chainId}:`, err);
      return [];
    }
  }, [address, getChainProvider]);

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
      const isMobile = isMobileDevice();
      
      if (isMobile) {
        // On mobile, fetch sequentially with delays
        const allNFTs: MultichainDeedNFT[] = [];
        for (let i = 0; i < SUPPORTED_NETWORKS.length; i++) {
          const network = SUPPORTED_NETWORKS[i];
          const chainNFTs = await fetchChainNFTs(network.chainId);
          allNFTs.push(...chainNFTs);
          
          // Add delay between chains on mobile (except for the last one)
          if (i < SUPPORTED_NETWORKS.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        setNfts(allNFTs);
      } else {
        // On desktop, fetch all chains in parallel
        const nftPromises = SUPPORTED_NETWORKS.map(network => fetchChainNFTs(network.chainId));
        const results = await Promise.all(nftPromises);
        setNfts(results.flat());
      }
    } catch (err) {
      console.error('Error fetching multichain NFTs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch NFTs');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, fetchChainNFTs]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

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
