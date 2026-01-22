import { useState, useMemo, useCallback } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { SUPPORTED_NETWORKS, getContractAddressForNetwork, getAbiPathForNetwork } from '@/config/networks';
import { getCachedProvider } from '@/utils/rpcOptimizer';
import type { DeedNFT } from '@/context/DeedNFTContext';
import { getNFTs, checkServerHealth } from '@/utils/apiClient';

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
    // Silent fallback to base-sepolia ABI
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

  // Note: Provider is now managed by rpcOptimizer for better efficiency

  // Get DeedNFT data for a specific token (same approach as DeedNFTContext)
  const getDeedNFTData = useCallback(async (
    contractAddress: string,
    abi: any,
    tokenId: string,
    chainId: number
  ): Promise<MultichainDeedNFT | null> => {
    try {
      const provider = getCachedProvider(chainId);
      const contract = new ethers.Contract(contractAddress, abi, provider);
      const networkConfig = SUPPORTED_NETWORKS.find(n => n.chainId === chainId);
      
      // Get owner
      const owner = await contract.ownerOf(tokenId);
      
      // Only return if owned by user
      if (owner.toLowerCase() !== address?.toLowerCase()) {
        return null;
      }
      
      // Get token URI
      const uri = await contract.tokenURI(tokenId).catch(() => '');
      
      // Get validation status
      let validatorAddress = ethers.ZeroAddress;
      try {
        const [isValidated, validator] = await contract.getValidationStatus(tokenId);
        if (isValidated) {
          validatorAddress = validator;
        }
      } catch (err) {
        // Silent error - validation status not available
      }
      
      // Get asset type from contract traits
      let assetType = 0; // Default to Land
      try {
        const assetTypeKey = ethers.keccak256(ethers.toUtf8Bytes("assetType"));
        const assetTypeBytes = await contract.getTraitValue(tokenId, assetTypeKey);
        if (assetTypeBytes && assetTypeBytes.length > 0) {
          assetType = Number(ethers.AbiCoder.defaultAbiCoder().decode(["uint8"], assetTypeBytes)[0]);
        }
      } catch (err) {
        // Silent error - use default asset type
      }
      
      // Get definition from contract traits
      let definition = `T-Deed #${tokenId}`;
      try {
        const definitionBytes = await contract.getTraitValue(
          tokenId,
          ethers.keccak256(ethers.toUtf8Bytes("definition"))
        );
        if (definitionBytes && definitionBytes.length > 0) {
          definition = ethers.AbiCoder.defaultAbiCoder().decode(["string"], definitionBytes)[0];
        }
      } catch (err) {
        // Silent error - use default definition
      }
      
      // Get configuration from contract traits
      let configuration = "";
      try {
        const configurationBytes = await contract.getTraitValue(
          tokenId,
          ethers.keccak256(ethers.toUtf8Bytes("configuration"))
        );
        if (configurationBytes && configurationBytes.length > 0) {
          configuration = ethers.AbiCoder.defaultAbiCoder().decode(["string"], configurationBytes)[0];
        }
      } catch (err) {
        // Silent error - configuration will be empty
      }
      
      // Get token and salt (if available)
      let token = ethers.ZeroAddress;
      let salt = "0";
      try {
        token = await contract.token(tokenId).catch(() => ethers.ZeroAddress);
        salt = await contract.salt(tokenId).catch(() => "0");
      } catch (err) {
        // Silent error - use defaults
      }
      
      return {
        tokenId,
        owner,
        assetType,
        uri,
        definition,
        configuration,
        validatorAddress,
        token,
        salt,
        isMinted: true,
        chainId,
        chainName: networkConfig?.name || `Chain ${chainId}`,
      };
    } catch (err) {
      // Silent error - return null
      return null;
    }
  }, [address]);

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
      // Try server API first (with Redis caching)
      const isServerAvailable = await checkServerHealth();
      if (isServerAvailable) {
        try {
          const serverNFTs = await getNFTs(chainId, address, contractAddress);
          if (serverNFTs && serverNFTs.nfts) {
            // Map server response to MultichainDeedNFT format
            return serverNFTs.nfts.map((nft: any) => ({
              ...nft,
              chainId,
              chainName: networkConfig.name,
            }));
          }
        } catch (serverError) {
          // Server failed, fall through to direct contract calls
        }
      }

      // Fallback to direct contract calls if server is unavailable
      const provider = getCachedProvider(chainId);
      const abi = await getDeedNFTAbi(chainId);
      const contract = new ethers.Contract(contractAddress, abi, provider);

      // Get total supply
      const totalSupply = await contract.totalSupply().catch(() => 0n);
      if (totalSupply === 0n) return [];

      // Get all token IDs owned by the user using tokenByIndex (same as DeedNFTContext)
      const userNFTs: MultichainDeedNFT[] = [];
      const maxTokens = Number(totalSupply);
      
      // Process tokens in batches to avoid overwhelming the provider
      const batchSize = 10; // Smaller batches since we're doing more contract calls per token
      
      for (let i = 0; i < Math.min(maxTokens, 1000); i += batchSize) {
        const batchPromises: Promise<void>[] = [];
        
        for (let j = i; j < Math.min(i + batchSize, maxTokens); j++) {
          batchPromises.push(
            (async () => {
              try {
                // Use tokenByIndex to get token ID (same as DeedNFTContext)
                const tokenId = await contract.tokenByIndex(j);
                const tokenIdString = tokenId.toString();
                
                // Get full DeedNFT data using the same approach as DeedNFTContext
                const deedNFTData = await getDeedNFTData(contractAddress, abi, tokenIdString, chainId);
                if (deedNFTData) {
                  userNFTs.push(deedNFTData);
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
      // Silent error - return empty array
      return [];
    }
  }, [address, getDeedNFTData]);

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
      // Silent error handling
      setError(err instanceof Error ? err.message : 'Failed to fetch NFTs');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, fetchChainNFTs]);

  // Initial load
  // Note: Automatic refresh is now controlled by PortfolioContext
  // This hook only provides the refresh function - it does not auto-refresh

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
