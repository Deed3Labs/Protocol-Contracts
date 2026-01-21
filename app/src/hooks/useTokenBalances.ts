import { useState, useEffect, useMemo } from 'react';
import { useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { getRpcUrlForNetwork } from '@/config/networks';
import { getEthereumProvider } from '@/utils/providerUtils';
import { usePricingData, getUniswapPrice, getExplorerPrice } from './usePricingData';

export interface TokenBalance {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string; // Formatted balance
  balanceRaw: bigint; // Raw balance
  balanceUSD: number; // USD value
  logoUrl?: string;
}

interface UseTokenBalancesReturn {
  tokens: TokenBalance[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// Common token addresses by chain ID
const COMMON_TOKENS: Record<number, Array<{ address: string; symbol: string; name: string; decimals: number; logoUrl?: string }>> = {
  1: [ // Ethereum Mainnet
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  ],
  8453: [ // Base Mainnet
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  ],
  11155111: [ // Sepolia
    { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
  84532: [ // Base Sepolia
    { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  ],
};

// ERC20 ABI for balanceOf, symbol, name, decimals
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
];

/**
 * Hook to fetch ERC20 token balances for the connected wallet
 */
export function useTokenBalances(): UseTokenBalancesReturn {
  const { address, isConnected } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get chain ID
  const chainId = useMemo(() => {
    return caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  }, [caipNetworkId]);

  // Get ETH price for WETH conversion
  const { price: ethPrice } = usePricingData();

  // Helper to get token price (will fetch from Uniswap if needed)
  const getTokenPrice = async (symbol: string, address: string, provider: ethers.Provider, chainId: number): Promise<number> => {
    // Stablecoins are always $1
    if (['USDC', 'USDT', 'DAI'].includes(symbol)) return 1.0;
    
    // WETH uses ETH price
    if (symbol === 'WETH') return ethPrice;
    
    // For other tokens, fetch from Uniswap
    try {
      const price = await getUniswapPrice(provider, address, chainId);
      if (price && price > 0) return price;
      
      // Fallback to explorer if Uniswap fails
      const explorerPrice = await getExplorerPrice(address, chainId);
      if (explorerPrice && explorerPrice > 0) return explorerPrice;
    } catch (error) {
      console.error(`Error fetching price for ${symbol}:`, error);
    }
    
    return 0; // Default to 0 if price can't be determined
  };

  const fetchTokenBalances = async () => {
    if (!isConnected || !address || !chainId) {
      setTokens([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Add delay for mobile wallet connections
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      let provider: ethers.Provider;

      try {
        provider = await getEthereumProvider();
      } catch (providerError) {
        if (!chainId) {
          throw new Error('No chain ID available');
        }
        
        const rpcUrl = getRpcUrlForNetwork(chainId);
        if (!rpcUrl) {
          throw new Error(`No RPC URL available for chain ${chainId}`);
        }
        
        provider = new ethers.JsonRpcProvider(rpcUrl);
      }

      const tokenList = COMMON_TOKENS[chainId] || [];
      const tokenBalances: TokenBalance[] = [];

      // Fetch balances for each token in parallel
      const balancePromises = tokenList.map(async (tokenInfo) => {
        try {
          const contract = new ethers.Contract(tokenInfo.address, ERC20_ABI, provider);
          
          // Fetch balance, symbol, name, decimals in parallel
          const [balance, symbol, name, decimals] = await Promise.all([
            contract.balanceOf(address),
            contract.symbol().catch(() => tokenInfo.symbol),
            contract.name().catch(() => tokenInfo.name),
            contract.decimals().catch(() => tokenInfo.decimals),
          ]);

          // Only include tokens with non-zero balance
          if (balance > 0n) {
            const formattedBalance = ethers.formatUnits(balance, decimals);
            const balanceNum = parseFloat(formattedBalance);
            const tokenPrice = await getTokenPrice(symbol, tokenInfo.address, provider, chainId);
            const balanceUSD = balanceNum * tokenPrice;

            tokenBalances.push({
              address: tokenInfo.address,
              symbol,
              name,
              decimals,
              balance: formattedBalance,
              balanceRaw: balance,
              balanceUSD,
              logoUrl: tokenInfo.logoUrl,
            });
          }
        } catch (err) {
          // Silently skip tokens that fail to fetch
          console.warn(`Failed to fetch balance for ${tokenInfo.symbol}:`, err);
        }
      });

      await Promise.all(balancePromises);

      // Sort by USD value (highest first)
      tokenBalances.sort((a, b) => b.balanceUSD - a.balanceUSD);

      setTokens(tokenBalances);
    } catch (err) {
      console.error('Error fetching token balances:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch token balances');
      setTokens([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTokenBalances();

    // Refresh every 30 seconds
    const interval = setInterval(fetchTokenBalances, 30000);

    // Listen for mobile wallet return events
    const handleMobileWalletReturn = () => {
      setTimeout(fetchTokenBalances, 1000);
    };

    window.addEventListener('mobileWalletReturn', handleMobileWalletReturn);

    return () => {
      clearInterval(interval);
      window.removeEventListener('mobileWalletReturn', handleMobileWalletReturn);
    };
  }, [address, isConnected, chainId, ethPrice]);

  return {
    tokens,
    isLoading,
    error,
    refresh: fetchTokenBalances
  };
}
