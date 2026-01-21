import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppKitNetwork } from '@reown/appkit/react';
import { ethers } from 'ethers';
import { getRpcUrlForNetwork } from '@/config/networks';
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
 * Get price from a specific Uniswap V3 pool
 * Based on AssuranceOracle.sol implementation
 * Returns price of token0 in terms of token1, adjusted to 18 decimals
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
    const sqrtPriceX96 = slot0[0]; // uint160

    // Get token decimals
    const token0 = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1 = new ethers.Contract(token1Address, ERC20_ABI, provider);
    const decimals0 = Number(await token0.decimals());
    const decimals1 = Number(await token1.decimals());

    // Calculate price from sqrtPriceX96
    // Following AssuranceOracle.sol: price = (sqrtPriceX96 * sqrtPriceX96) >> (96 * 2)
    // This gives us: price = (sqrtPriceX96^2) / (2^192)
    // The result is token1/token0 in Q64.96 fixed point
    
    const sqrtPrice = BigInt(sqrtPriceX96.toString());
    const Q96 = 2n ** 96n;
    const Q192 = Q96 * Q96;
    
    // Calculate: price = (sqrtPriceX96^2) / (2^192)
    // This is token1/token0 ratio
    const priceX192 = sqrtPrice * sqrtPrice;
    
    // Convert to number with proper scaling
    // We'll work in 18 decimals for the final result
    const SCALE_18 = 10n ** 18n;
    
    // Calculate: (priceX192 * 10^18) / Q192
    // This gives us price in 18 decimals
    const scaledPrice = (priceX192 * SCALE_18) / Q192;
    
    // Convert to JavaScript number
    let price = Number(scaledPrice) / 1e18;

    // Adjust for token decimals (following AssuranceOracle.sol logic)
    // The price from Uniswap is in raw units, we need to adjust for decimals
    if (decimals0 > decimals1) {
      price = price / Math.pow(10, decimals0 - decimals1);
    } else if (decimals1 > decimals0) {
      price = price * Math.pow(10, decimals1 - decimals0);
    }
    
    // Ensure price is in 18 decimals (as per AssuranceOracle)
    if (decimals0 < 18) {
      price = price * Math.pow(10, 18 - decimals0);
    } else if (decimals0 > 18) {
      price = price / Math.pow(10, decimals0 - 18);
    }

    return price;
  } catch (error) {
    console.error('Error getting pool price:', error);
    return 0;
  }
}

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
      // Check which token is token0 in the pool
      const pool = new ethers.Contract(usdcPoolAddress, UNISWAP_V3_POOL_ABI, provider);
      const token0Address = await pool.token0();
      const token1Address = await pool.token1();
      
      const price = await getPoolPrice(provider, usdcPoolAddress, token0Address, token1Address);
      if (price > 0) {
        // Price is in 18 decimals, representing token1/token0
        // If token0 is our token and token1 is USDC, we need to invert
        // If token1 is our token and token0 is USDC, price is already token/USDC
        if (token0Address.toLowerCase() === tokenAddress.toLowerCase()) {
          // Our token is token0, USDC is token1
          // Price is USDC/token, so we need token/USDC = 1 / (USDC/token)
          // But price is in 18 decimals, so: token/USDC = 1e18 / price
          return Number(1e18) / price;
        } else {
          // Our token is token1, USDC is token0
          // Price is token/USDC, which is what we want
          return price / 1e18; // Convert from 18 decimals to normal number
        }
      }
    }

    // Try via WETH if no direct USDC pair
    const wethPoolAddress = await factory.getPool(tokenAddress, wethAddress, FEE_TIER);
    if (wethPoolAddress && wethPoolAddress !== ethers.ZeroAddress) {
      const pool = new ethers.Contract(wethPoolAddress, UNISWAP_V3_POOL_ABI, provider);
      const token0Address = await pool.token0();
      const token1Address = await pool.token1();
      
      const tokenWethPrice = await getPoolPrice(provider, wethPoolAddress, token0Address, token1Address);
      if (tokenWethPrice > 0) {
        // Get WETH/USDC price
        const wethUsdcPoolAddress = await factory.getPool(wethAddress, usdcAddress, FEE_TIER);
        if (wethUsdcPoolAddress && wethUsdcPoolAddress !== ethers.ZeroAddress) {
          const wethUsdcPool = new ethers.Contract(wethUsdcPoolAddress, UNISWAP_V3_POOL_ABI, provider);
          const wethUsdcToken0 = await wethUsdcPool.token0();
          const wethUsdcToken1 = await wethUsdcPool.token1();
          
          const wethUsdcPrice = await getPoolPrice(provider, wethUsdcPoolAddress, wethUsdcToken0, wethUsdcToken1);
          if (wethUsdcPrice > 0) {
            // Calculate token price in USD
            // tokenWethPrice is in 18 decimals (token/WETH or WETH/token)
            // wethUsdcPrice is in 18 decimals (WETH/USDC or USDC/WETH)
            
            // Determine if we need to invert tokenWethPrice
            let tokenWethRatio: number;
            if (token0Address.toLowerCase() === tokenAddress.toLowerCase()) {
              // Token is token0, WETH is token1
              tokenWethRatio = Number(1e18) / tokenWethPrice; // Invert to get token/WETH
            } else {
              // Token is token1, WETH is token0
              tokenWethRatio = tokenWethPrice / 1e18; // Already token/WETH
            }
            
            // Determine if we need to invert wethUsdcPrice
            let wethUsdcRatio: number;
            if (wethUsdcToken0.toLowerCase() === wethAddress.toLowerCase()) {
              // WETH is token0, USDC is token1
              wethUsdcRatio = wethUsdcPrice / 1e18; // Already WETH/USDC
            } else {
              // WETH is token1, USDC is token0
              wethUsdcRatio = Number(1e18) / wethUsdcPrice; // Invert to get WETH/USDC
            }
            
            // Calculate: (token/WETH) * (WETH/USDC) = token/USDC
            return tokenWethRatio * wethUsdcRatio;
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
 * Get price from CoinGecko API (fallback)
 */
async function getCoinGeckoPrice(
  tokenAddress: string,
  chainId: number
): Promise<number | null> {
  try {
    // Map chain IDs to CoinGecko platform IDs
    const platformMap: Record<number, string> = {
      1: 'ethereum',
      8453: 'base',
      11155111: 'ethereum', // Sepolia uses Ethereum platform
      84532: 'base', // Base Sepolia uses Base platform
    };

    const platform = platformMap[chainId];
    if (!platform) return null;

    // For native tokens (ETH), use the native token ID
    const wethAddress = WETH_ADDRESSES[chainId];
    if (tokenAddress.toLowerCase() === wethAddress.toLowerCase()) {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`,
        { method: 'GET' }
      );
      
      if (response.ok) {
        const data = await response.json();
        return data.ethereum?.usd || null;
      }
    }

    // For other tokens, use the contract address
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${tokenAddress}&vs_currencies=usd`,
      { method: 'GET' }
    );

    if (response.ok) {
      const data = await response.json();
      const tokenData = data[tokenAddress.toLowerCase()];
      return tokenData?.usd || null;
    }

    return null;
  } catch (error) {
    console.error('Error fetching CoinGecko price:', error);
    return null;
  }
}

/**
 * Get price from chain explorer API (fallback - currently not implemented as it requires API keys)
 */
export async function getExplorerPrice(
  _tokenAddress: string,
  _chainId: number
): Promise<number | null> {
  // Explorer APIs typically require API keys for price data
  // For now, return null to fall back to CoinGecko
  return null;
}

/**
 * Get native token address (WETH/Wrapped ETH) for a chain
 */
function getNativeTokenAddress(chainId: number): string | null {
  return WETH_ADDRESSES[chainId] || null;
}

/**
 * Hook to fetch token prices using Uniswap and CoinGecko
 * Priority: Uniswap V3 > CoinGecko
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

      // Fallback to CoinGecko if Uniswap fails
      if (!tokenPrice || tokenPrice === 0 || !isFinite(tokenPrice)) {
        tokenPrice = await getCoinGeckoPrice(targetTokenAddress, chainId);
      }

      // For stablecoins, default to $1 if no price found
      if (!tokenPrice || tokenPrice === 0 || !isFinite(tokenPrice)) {
        try {
          const tokenContract = new ethers.Contract(targetTokenAddress, ['function symbol() view returns (string)'], provider);
          const symbol = await tokenContract.symbol();
          if (['USDC', 'USDT', 'DAI'].includes(symbol)) {
            tokenPrice = 1;
          }
        } catch (e) {
          // Ignore errors when checking symbol
        }
      }

      if (tokenPrice && tokenPrice > 0 && isFinite(tokenPrice)) {
        setPrice(tokenPrice);
      } else {
        setError('Price not available from Uniswap or CoinGecko');
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
