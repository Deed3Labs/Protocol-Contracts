import { useState, useEffect, useMemo } from 'react';
import { useAppKitNetwork } from '@reown/appkit/react';

interface TokenPrice {
  price: number; // Price in USD
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to fetch the USD price of the native token (ETH, etc.)
 * Uses CoinGecko API for price data
 */
export function useTokenPrice(): TokenPrice {
  const { caipNetworkId } = useAppKitNetwork();
  const [price, setPrice] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get chain ID to determine which token to fetch
  const chainId = useMemo(() => {
    return caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  }, [caipNetworkId]);

  // Map chain IDs to CoinGecko token IDs
  const getTokenId = (chainId?: number): string => {
    // CoinGecko token IDs
    const tokenMap: Record<number, string> = {
      1: 'ethereum', // Ethereum Mainnet
      8453: 'ethereum', // Base (uses ETH)
      11155111: 'ethereum', // Sepolia (uses ETH)
      84532: 'ethereum', // Base Sepolia (uses ETH)
    };
    return tokenMap[chainId || 1] || 'ethereum';
  };

  useEffect(() => {
    const fetchPrice = async () => {
      if (!chainId) {
        setPrice(0);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const tokenId = getTokenId(chainId);
        
        // Use CoinGecko API (free tier, no API key required)
        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`,
          {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            },
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch price: ${response.statusText}`);
        }

        const data = await response.json();
        const tokenPrice = data[tokenId]?.usd;

        if (typeof tokenPrice === 'number') {
          setPrice(tokenPrice);
        } else {
          throw new Error('Invalid price data received');
        }
      } catch (err) {
        console.error('Error fetching token price:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch price');
        // Don't set price to 0 on error, keep last known price
      } finally {
        setIsLoading(false);
      }
    };

    fetchPrice();

    // Refresh price every 60 seconds
    const interval = setInterval(fetchPrice, 60000);

    return () => clearInterval(interval);
  }, [chainId]);

  return {
    price,
    isLoading,
    error
  };
}
