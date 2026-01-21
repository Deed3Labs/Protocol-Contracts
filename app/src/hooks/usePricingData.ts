import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppKitNetwork } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { getNetworkByChainId, getRpcUrlForNetwork } from '@/config/networks';
import { getEthereumProvider } from '@/utils/providerUtils';

interface PricingData {
  price: number; // Price in USD
  isLoading: boolean;
  error: string | null;
}

// Uniswap V3 Factory addresses by chain
const UNISWAP_V3_FACTORY: Record<number, string> = {
  1: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Ethereum Mainnet
  8453: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', // Base Mainnet
  11155111: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c', // Sepolia
  84532: '0x4200000000000000000000000000000000000006', // Base Sepolia (using WETH address as placeholder)
};

// Common stablecoin addresses
const USDC_ADDRESSES: Record<number, string> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum Mainnet
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base Mainnet
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
};

const WETH_ADDRESSES: Record<number, string> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Ethereum Mainnet
  8453: '0x4200000000000000000000000000000000000006', // Base Mainnet (WETH)
  11155111: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // Sepolia
  84532: '0x4200000000000000000000000000000000000006', // Base Sepolia
};

// Uniswap V3 Pool ABI (minimal interface for slot0)
const UNISWAP_V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

// Uniswap V3 Factory ABI
const UNISWAP_V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

// ERC20 ABI for decimals
const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

const FEE_TIER = 3000; // 0.3% fee tier

/**
 * Get price from Uniswap V3 pool
 * Exported for use in other hooks
 */
export async function getUniswapPrice(
  provider: ethers.Provider,
  tokenAddress: string,
  chainId: number
): Promise<number | null> {
  try {
    const factoryAddress = UNISWAP_V3_FACTORY[chainId];
    const usdcAddress = USDC_ADDRESSES[chainId];
    const wethAddress = WETH_ADDRESSES[chainId];

    if (!factoryAddress || !usdcAddress || !wethAddress) {
      return null;
    }

    const factory = new ethers.Contract(factoryAddress, UNISWAP_V3_FACTORY_ABI, provider);

    // Try direct USDC pair first
    const usdcPoolAddress = await factory.getPool(tokenAddress, usdcAddress, FEE_TIER);
    if (usdcPoolAddress && usdcPoolAddress !== ethers.ZeroAddress) {
      const price = await getPoolPrice(provider, usdcPoolAddress, tokenAddress, usdcAddress);
      if (price > 0) return price;
    }

    // Try via WETH if no direct USDC pair
    const wethPoolAddress = await factory.getPool(tokenAddress, wethAddress, FEE_TIER);
    if (wethPoolAddress && wethPoolAddress !== ethers.ZeroAddress) {
      const tokenWethPrice = await getPoolPrice(provider, wethPoolAddress, tokenAddress, wethAddress);
      if (tokenWethPrice > 0) {
        const wethUsdcPoolAddress = await factory.getPool(wethAddress, usdcAddress, FEE_TIER);
        if (wethUsdcPoolAddress && wethUsdcPoolAddress !== ethers.ZeroAddress) {
          const wethUsdcPrice = await getPoolPrice(provider, wethUsdcPoolAddress, wethAddress, usdcAddress);
          if (wethUsdcPrice > 0) {
            // Calculate token price in USD: (token/WETH) * (WETH/USDC)
            return (tokenWethPrice * wethUsdcPrice) / 1e18;
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error fetching Uniswap price:', error);
    return null;
  }
}

/**
 * Get price from a specific Uniswap V3 pool
 * Returns price of token0 in terms of token1
 */
async function getPoolPrice(
  provider: ethers.Provider,
  poolAddress: string,
  token0Address: string,
  token1Address: string
): Promise<number> {
  try {
    const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);
    const slot0 = await pool.slot0();
    const sqrtPriceX96 = slot0[0]; // First return value (uint160)

    // Get token decimals
    const token0 = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1 = new ethers.Contract(token1Address, ERC20_ABI, provider);
    const decimals0 = await token0.decimals();
    const decimals1 = await token1.decimals();

    // Calculate price from sqrtPriceX96
    // sqrtPriceX96 = sqrt(token1/token0) * 2^96
    // price = token1/token0 = (sqrtPriceX96 / 2^96)^2
    
    const sqrtPrice = BigInt(sqrtPriceX96.toString());
    const Q96 = 2n ** 96n;
    
    // Calculate price = (sqrtPriceX96^2) / (2^96)^2
    // To maintain precision and avoid BigInt overflow when converting to Number,
    // we'll scale the calculation before division
    const priceX192 = sqrtPrice * sqrtPrice;
    const Q192 = Q96 * Q96;
    
    // Scale by 1e18 to maintain precision when converting to number
    // This allows us to do the division in BigInt first, then scale down
    const SCALE = 1e18;
    const scaleBigInt = BigInt(SCALE);
    
    // Calculate: (priceX192 * scale) / Q192
    // This gives us the price scaled by 1e18, all in BigInt
    const scaledPrice = (priceX192 * scaleBigInt) / Q192;
    
    // Convert to number (scaledPrice should be within safe number range now)
    // If it's still too large, we'll need to scale down further
    let price: number;
    try {
      price = Number(scaledPrice) / SCALE;
    } catch (e) {
      // If still too large, scale down more
      const smallerScale = 1e9;
      const smallerScaleBigInt = BigInt(smallerScale);
      const smallerScaledPrice = (priceX192 * smallerScaleBigInt) / Q192;
      price = Number(smallerScaledPrice) / smallerScale;
    }

    // Adjust for token decimals
    // The price from Uniswap is token1/token0 in raw units
    // We need to adjust: price = (token1/token0) * (10^decimals0 / 10^decimals1)
    const decimals0Num = Number(decimals0);
    const decimals1Num = Number(decimals1);
    const decimalDiff = decimals0Num - decimals1Num;
    
    if (decimalDiff > 0) {
      price = price * Math.pow(10, decimalDiff);
    } else if (decimalDiff < 0) {
      price = price / Math.pow(10, Math.abs(decimalDiff));
    }

    // The price from Uniswap is token1/token0
    // If we want token0/token1 (which is what we need when token1 is USDC), we invert
    const token0Symbol = await token0.symbol();
    
    // If token1 is USDC (our quote token), price is already token0/USDC, so we're good
    // If token0 is USDC, we need to invert
    if (token0Symbol === 'USDC' || token0Symbol === 'USDT' || token0Symbol === 'DAI') {
      price = 1 / price;
    }

    return price;
  } catch (error) {
    console.error('Error getting pool price:', error);
    return 0;
  }
}

/**
 * Get price from chain explorer API (fallback)
 * Note: Explorer APIs may require API keys, but we try without first
 * Exported for use in other hooks
 */
export async function getExplorerPrice(
  _tokenAddress: string, // Token address (currently unused as explorer APIs require API keys)
  chainId: number
): Promise<number | null> {
  try {
    const networkConfig = getNetworkByChainId(chainId);
    if (!networkConfig) return null;

    // Explorer APIs typically require API keys for price data
    // For now, skip as it requires API keys
    // In production, you could add API key support via environment variables
    // Example for Basescan:
    //   const apiUrl = networkConfig.blockExplorer.replace('basescan.org', 'api.basescan.org');
    //   const response = await fetch(`${apiUrl}/api?module=token&action=tokeninfo&contractaddress=${_tokenAddress}&apikey=${apiKey}`);
    // Example for Etherscan:
    //   const apiUrl = networkConfig.blockExplorer.replace('etherscan.io', 'api.etherscan.io');
    //   const response = await fetch(`${apiUrl}/api?module=token&action=tokeninfo&contractaddress=${_tokenAddress}&apikey=${apiKey}`);

    // Return null to fall back to other methods
    return null;
  } catch (error) {
    console.error('Error fetching explorer price:', error);
    return null;
  }
}

/**
 * Get native token address (WETH/Wrapped ETH) for a chain
 */
function getNativeTokenAddress(chainId: number): string | null {
  return WETH_ADDRESSES[chainId] || null;
}

/**
 * Hook to fetch token prices using Uniswap and chain explorers
 * Decentralized pricing - no reliance on centralized APIs
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
      // Get provider
      let provider: ethers.Provider;
      try {
        provider = await getEthereumProvider();
      } catch (providerError) {
        const rpcUrl = getRpcUrlForNetwork(chainId);
        if (!rpcUrl) {
          throw new Error(`No RPC URL available for chain ${chainId}`);
        }
        provider = new ethers.JsonRpcProvider(rpcUrl);
      }

      // Try Uniswap first (primary source)
      let tokenPrice = await getUniswapPrice(provider, targetTokenAddress, chainId);

      // Fallback to chain explorer API if Uniswap fails
      if (!tokenPrice || tokenPrice === 0) {
        tokenPrice = await getExplorerPrice(targetTokenAddress, chainId);
      }

      // For stablecoins, default to $1 if no price found
      if (!tokenPrice || tokenPrice === 0) {
        const tokenContract = new ethers.Contract(targetTokenAddress, ERC20_ABI, provider);
        const symbol = await tokenContract.symbol();
        if (['USDC', 'USDT', 'DAI'].includes(symbol)) {
          tokenPrice = 1;
        }
      }

      if (tokenPrice && tokenPrice > 0) {
        setPrice(tokenPrice);
      } else {
        setError('Price not available from Uniswap or explorer');
      }
    } catch (err) {
      console.error('Error fetching token price:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch price');
      // Don't set price to 0 on error, keep last known price
    } finally {
      setIsLoading(false);
    }
  }, [chainId, targetTokenAddress]);

  useEffect(() => {
    fetchPrice();

    // Refresh price every 60 seconds
    const interval = setInterval(fetchPrice, 60000);

    return () => clearInterval(interval);
  }, [fetchPrice]);

  return {
    price,
    isLoading,
    error
  };
}

/**
 * Hook specifically for native token price (backward compatibility)
 */
export function useTokenPrice(): PricingData {
  return usePricingData();
}
