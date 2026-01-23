import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppKitNetwork } from '@reown/appkit/react';
import { getTokenPrice } from '@/utils/apiClient';
import { withTimeout } from './utils/multichainHelpers';

interface PricingData {
  price: number; // Price in USD
  isLoading: boolean;
  error: string | null;
}

// Wrapped token addresses for native tokens (used for price fetching)
const WETH_ADDRESSES: Record<number, string> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Ethereum Mainnet (WETH)
  8453: '0x4200000000000000000000000000000000000006', // Base Mainnet (WETH)
  11155111: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // Sepolia (WETH)
  84532: '0x4200000000000000000000000000000000000006', // Base Sepolia (WETH)
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // Arbitrum One (WETH)
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // Polygon (WPOL - wrapped POL, not WETH!)
  100: '0xe91D153E0b41518A2Ce8Dd3D7944F8638934d2C8', // Gnosis (WXDAI)
};

/**
 * Get wrapped native token address (WETH/Wrapped ETH/POL/xDAI) for a chain
 * Used to fetch native token prices via server API
 */
export function getNativeTokenAddress(chainId: number): string | null {
  return WETH_ADDRESSES[chainId] || null;
}

/**
 * Hook to fetch token prices from server API
 * 
 * Fetches token prices from server API (which handles Uniswap/Coinbase/CoinGecko internally).
 * Works for both ERC20 tokens and native tokens (via wrapped token addresses).
 * 
 * If no token address is provided, fetches the native token price for the current chain.
 * 
 * @param tokenAddress - Optional token contract address. If not provided, fetches native token price.
 * 
 * @example
 * ```tsx
 * // Get native token price (ETH, POL, xDAI, etc. - automatically uses wrapped address)
 * const { price, isLoading } = usePricingData();
 * 
 * // Get specific token price
 * const { price: usdcPrice } = usePricingData('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
 * ```
 * 
 * @returns Object containing:
 * - `price`: Token price in USD
 * - `isLoading`: Whether price is currently loading
 * - `error`: Error message, if any
 */
export function usePricingData(tokenAddress?: string): PricingData {
  const { caipNetworkId } = useAppKitNetwork();
  const [price, setPrice] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get chain ID
  const chainId = useMemo(() => {
    return caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  }, [caipNetworkId]);

  // Determine which token to fetch price for
  const targetTokenAddress = useMemo(() => {
    if (tokenAddress) return tokenAddress;
    if (chainId) return getNativeTokenAddress(chainId);
    return null;
  }, [tokenAddress, chainId]);

  const fetchPrice = useCallback(async () => {
    if (!chainId || !targetTokenAddress) {
      setPrice(0);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Try server API first (with Redis caching) - don't wait for health check
      // This is faster and more resilient - if server is down, API call will fail quickly
      try {
        const serverPrice = await withTimeout(
          getTokenPrice(chainId, targetTokenAddress),
          3000
        ) as Awaited<ReturnType<typeof getTokenPrice>> | null;
        
        if (serverPrice && serverPrice.price > 0 && isFinite(serverPrice.price)) {
          setPrice(serverPrice.price);
          setIsLoading(false);
          return; // Successfully fetched from server
        }
      } catch (serverError) {
        // Server failed or timed out - log details in development
        if (import.meta.env.DEV) {
          console.warn('[usePricingData] Server API failed:', {
            error: serverError instanceof Error ? serverError.message : serverError,
            chainId,
            tokenAddress: targetTokenAddress,
            apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'
          });
        }
      }

      // Server API is required in production
      if (import.meta.env.PROD) {
        console.error('[usePricingData] Server API failed in production!', {
          chainId,
          tokenAddress: targetTokenAddress,
          apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'NOT SET',
          error: 'Check VITE_API_BASE_URL environment variable and server status'
        });
        setError('Server API is required but unavailable');
        return;
      }

      // In development, set error but don't throw
      setError('Server API unavailable - server is required for pricing');
    } catch (err) {
      console.error('Error fetching token price:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch price');
      // Don't set price to 0 on error, keep last known price
    } finally {
      setIsLoading(false);
    }
  }, [chainId, targetTokenAddress]);

  // Initial price fetch only - no auto-refresh
  // Price updates are now controlled by PortfolioContext (once per hour)
  useEffect(() => {
    fetchPrice();
  }, [fetchPrice]);

  return {
    price,
    isLoading,
    error
  };
}

/**
 * Hook specifically for native token price (backward compatibility)
 * 
 * @deprecated Use `usePricingData()` instead. This hook is kept for backward compatibility.
 * 
 * @returns Pricing data for the native token of the current chain
 */
export function useTokenPrice(): PricingData {
  return usePricingData();
}
