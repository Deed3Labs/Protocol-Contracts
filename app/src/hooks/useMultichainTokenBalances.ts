import { useState, useMemo, useCallback } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { SUPPORTED_NETWORKS } from '@/config/networks';
import { getUniswapPrice, getCoinGeckoPrice } from './usePricingData';
import { getCachedProvider, executeBatchRpcCalls } from '@/utils/rpcOptimizer';

// Detect mobile device
const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

export interface MultichainTokenBalance {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceRaw: bigint;
  balanceUSD: number;
  chainId: number;
  chainName: string;
  logoUrl?: string;
}

interface UseMultichainTokenBalancesReturn {
  tokens: MultichainTokenBalance[];
  totalValueUSD: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshChain: (chainId: number) => Promise<void>;
}

// Common token addresses by chain ID (same as useTokenBalances)
const COMMON_TOKENS: Record<number, Array<{ address: string; symbol: string; name: string; decimals: number; logoUrl?: string }>> = {
  1: [
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  ],
  8453: [
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  ],
  11155111: [
    { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
  84532: [
    { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  ],
};

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
];

/**
 * Hook to fetch ERC20 token balances across all supported networks
 */
export function useMultichainTokenBalances(): UseMultichainTokenBalancesReturn {
  const { address, isConnected } = useAppKitAccount();
  const [tokens, setTokens] = useState<MultichainTokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Note: Provider is now managed by rpcOptimizer for better efficiency

  // Get token price with fallback to CoinGecko
  const getTokenPrice = useCallback(async (symbol: string, address: string, provider: ethers.Provider, chainId: number): Promise<number> => {
    // Stablecoins are always $1
    if (['USDC', 'USDT', 'DAI'].includes(symbol)) return 1.0;
    
    // Try Uniswap first (primary source)
    try {
      const price = await getUniswapPrice(provider, address, chainId);
      if (price && price > 0 && isFinite(price)) return price;
    } catch (error) {
      // Continue to fallback
    }
    
    // Fallback to CoinGecko if Uniswap fails
    try {
      const price = await getCoinGeckoPrice(address, chainId);
      if (price && price > 0 && isFinite(price)) return price;
    } catch (error) {
      // Silent fallback - price will default to 0
    }
    
    return 0;
  }, []);

  // Fetch token balances for a specific chain
  const fetchChainTokens = useCallback(async (chainId: number): Promise<MultichainTokenBalance[]> => {
    if (!address) return [];

    const networkConfig = SUPPORTED_NETWORKS.find(n => n.chainId === chainId);
    if (!networkConfig) return [];

    const tokenList = COMMON_TOKENS[chainId] || [];
    if (tokenList.length === 0) return [];

    try {
      const provider = getCachedProvider(chainId);
      const tokenBalances: MultichainTokenBalance[] = [];

      // Batch fetch balances for all tokens at once (much more efficient)
      const balanceOfInterface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
      const balanceOfData = balanceOfInterface.encodeFunctionData('balanceOf', [address]);
      
      // Prepare batch calls for balances
      const balanceCalls = tokenList.map((tokenInfo, index) => ({
        method: 'eth_call',
        params: [{
          to: tokenInfo.address,
          data: balanceOfData
        }, 'latest'],
        id: index
      }));
      
      // Execute batch call
      const balanceResults = await executeBatchRpcCalls(chainId, balanceCalls, { useCache: true });
      
      // Process results - use contracts for metadata (simpler than batch decoding)
      const tokenPromises = tokenList.map(async (tokenInfo, index) => {
        try {
          const balanceHex = balanceResults[index];
          if (!balanceHex || balanceHex === '0x' || balanceHex === '0x0') {
            return null;
          }
          
          const balance = BigInt(balanceHex);
          if (balance === 0n) return null;
          
          // Use contract for metadata (cached provider, so still efficient)
          const contract = new ethers.Contract(tokenInfo.address, ERC20_ABI, provider);
          
          const [symbol, name, decimals] = await Promise.all([
            contract.symbol().catch(() => tokenInfo.symbol),
            contract.name().catch(() => tokenInfo.name),
            contract.decimals().catch(() => tokenInfo.decimals),
          ]);
          
          const formattedBalance = ethers.formatUnits(balance, decimals);
          const balanceNum = parseFloat(formattedBalance);
          const tokenPrice = await getTokenPrice(symbol, tokenInfo.address, provider, chainId);
          const balanceUSD = balanceNum * tokenPrice;

          return {
            address: tokenInfo.address,
            symbol,
            name,
            decimals,
            balance: formattedBalance,
            balanceRaw: balance,
            balanceUSD,
            chainId,
            chainName: networkConfig.name,
            logoUrl: tokenInfo.logoUrl,
          } as MultichainTokenBalance;
        } catch (err) {
          // Silent error - skip this token
          return null;
        }
      });
      
      const results = await Promise.all(tokenPromises);
      results.forEach(result => {
        if (result !== null) {
          tokenBalances.push(result);
        }
      });

      return tokenBalances.sort((a, b) => b.balanceUSD - a.balanceUSD);
    } catch (err) {
      // Silent error - return empty array
      return [];
    }
  }, [address, getTokenPrice]);

  // Refresh a specific chain
  const refreshChain = useCallback(async (chainId: number) => {
    if (!isConnected || !address) return;

    const chainTokens = await fetchChainTokens(chainId);
    setTokens(prev => {
      // Remove old tokens from this chain and add new ones
      const filtered = prev.filter(t => t.chainId !== chainId);
      return [...filtered, ...chainTokens];
    });
  }, [isConnected, address, fetchChainTokens]);

  // Refresh all chains
  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setTokens([]);
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
        const allTokens: MultichainTokenBalance[] = [];
        for (let i = 0; i < SUPPORTED_NETWORKS.length; i++) {
          const network = SUPPORTED_NETWORKS[i];
          const chainTokens = await fetchChainTokens(network.chainId);
          allTokens.push(...chainTokens);
          
          // Add delay between chains on mobile (except for the last one)
          if (i < SUPPORTED_NETWORKS.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        setTokens(allTokens);
      } else {
        // On desktop, fetch all chains in parallel
        const tokenPromises = SUPPORTED_NETWORKS.map(network => fetchChainTokens(network.chainId));
        const results = await Promise.all(tokenPromises);
        setTokens(results.flat());
      }
    } catch (err) {
      // Silent error handling
      setError(err instanceof Error ? err.message : 'Failed to fetch token balances');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, fetchChainTokens]);

  // Initial load
  // Note: Automatic refresh is now controlled by PortfolioContext
  // This hook only provides the refresh function - it does not auto-refresh

  // Calculate total value
  const totalValueUSD = useMemo(() => {
    return tokens.reduce((sum, t) => sum + (t.balanceUSD || 0), 0);
  }, [tokens]);

  return {
    tokens,
    totalValueUSD,
    isLoading,
    error,
    refresh,
    refreshChain,
  };
}
