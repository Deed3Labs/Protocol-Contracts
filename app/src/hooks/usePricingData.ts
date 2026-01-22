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
  84532: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', // Base Sepolia
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
    // sqrtPriceX96 = sqrt(token1/token0) * 2^96
    // So: price = token1/token0 = (sqrtPriceX96 / 2^96)^2
    
    const sqrtPrice = BigInt(sqrtPriceX96.toString());
    const Q96 = 2n ** 96n;
    
    // Calculate price = (sqrtPriceX96 / 2^96)^2 = token1/token0
    // To avoid overflow, we'll calculate this step by step
    // price = (sqrtPriceX96^2) / (2^192)
    
    // First, calculate numerator and denominator
    const numerator = sqrtPrice * sqrtPrice;
    const denominator = Q96 * Q96;
    
    // To get a human-readable ratio, we need to:
    // 1. Account for the Q64.96 format (divide by 2^192)
    // 2. Account for token decimals
    
    // Use a large scale for intermediate calculation to maintain precision
    const INTERMEDIATE_SCALE = 10n ** 36n; // Very large scale for precision
    
    // Calculate: (numerator * INTERMEDIATE_SCALE) / denominator
    // This gives us the ratio scaled by INTERMEDIATE_SCALE
    const scaledRatio = (numerator * INTERMEDIATE_SCALE) / denominator;
    
    // Now adjust for token decimals
    // Following the logic from AssuranceOracle.sol:
    // The price from sqrtPriceX96 is in Q64.96 format (token1_raw / token0_raw)
    // We need to adjust for decimals to get human-readable price
    // Solidity logic: if decimals0 > decimals1: divide by 10^(decimals0 - decimals1)
    //                 if decimals1 > decimals0: multiply by 10^(decimals1 - decimals0)
    
    let adjustedRatio = scaledRatio;
    
    if (decimals0 > decimals1) {
      // decimals0 > decimals1: divide by 10^(decimals0 - decimals1)
      const decimalDiff = decimals0 - decimals1;
      const decimalFactor = 10n ** BigInt(decimalDiff);
      adjustedRatio = adjustedRatio / decimalFactor;
    } else if (decimals1 > decimals0) {
      // decimals1 > decimals0: multiply by 10^(decimals1 - decimals0)
      const decimalDiff = decimals1 - decimals0;
      const decimalFactor = 10n ** BigInt(decimalDiff);
      adjustedRatio = adjustedRatio * decimalFactor;
    }
    // If decimals0 === decimals1, no adjustment needed
    
    // Convert to JavaScript number
    // adjustedRatio is scaled by INTERMEDIATE_SCALE, so divide by it
    // Check if adjustedRatio is valid before conversion
    if (adjustedRatio === 0n) {
      return 0;
    }
    
    let price = Number(adjustedRatio) / Number(INTERMEDIATE_SCALE);
    
    // Safety check - prices should be reasonable (between 1e-10 and 1e10 for most tokens)
    if (!isFinite(price) || price <= 0 || price > 1e10 || price < 1e-10) {
      // Only log if price is clearly invalid (not just very small)
      if (!isFinite(price) || price <= 0 || price > 1e10) {
        console.error('Price calculation error: invalid price', price, {
          sqrtPriceX96: sqrtPriceX96.toString(),
          decimals0,
          decimals1,
          decimalDiff: decimals0 - decimals1,
          adjustedRatio: adjustedRatio.toString()
        });
      }
      return 0;
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
    let usdcPoolAddress: string = ethers.ZeroAddress;
    try {
      const result = await factory.getPool(tokenAddress, usdcAddress, FEE_TIER);
      // Check if result is valid (not zero address and not empty)
      if (result && result !== ethers.ZeroAddress && result !== '0x') {
        usdcPoolAddress = result;
      }
    } catch (error) {
      // Pool doesn't exist or call failed - this is normal, continue to next option
      usdcPoolAddress = ethers.ZeroAddress;
    }
    
    if (usdcPoolAddress && usdcPoolAddress !== ethers.ZeroAddress) {
      // Check which token is token0 in the pool
      const pool = new ethers.Contract(usdcPoolAddress, UNISWAP_V3_POOL_ABI, provider);
      const token0Address = await pool.token0();
      const token1Address = await pool.token1();
      
      const price = await getPoolPrice(provider, usdcPoolAddress, token0Address, token1Address);
      if (price > 0 && isFinite(price)) {
        // Price from getPoolPrice is token1/token0 in human-readable units
        // If token0 is our token and token1 is USDC, price = USDC/token
        // If token1 is our token and token0 is USDC, price = token/USDC
        if (token0Address.toLowerCase() === tokenAddress.toLowerCase()) {
          // Our token is token0, USDC is token1
          // Price = USDC/token, so we need token/USDC = 1 / price
          const tokenPriceUSD = 1 / price;
          // USDC has 6 decimals, so if price is in terms of USDC, we're good
          return tokenPriceUSD;
        } else {
          // Our token is token1, USDC is token0
          // Price = token/USDC, which is what we want (token price in USD)
          return price;
        }
      }
    }

    // Try via WETH if no direct USDC pair
    let wethPoolAddress: string = ethers.ZeroAddress;
    try {
      const result = await factory.getPool(tokenAddress, wethAddress, FEE_TIER);
      wethPoolAddress = result && result !== ethers.ZeroAddress ? result : ethers.ZeroAddress;
    } catch (error) {
      // Pool doesn't exist or call failed - this is normal, continue to next option
      wethPoolAddress = ethers.ZeroAddress;
    }
    
    if (wethPoolAddress && wethPoolAddress !== ethers.ZeroAddress) {
      const pool = new ethers.Contract(wethPoolAddress, UNISWAP_V3_POOL_ABI, provider);
      const token0Address = await pool.token0();
      const token1Address = await pool.token1();
      
      const tokenWethPrice = await getPoolPrice(provider, wethPoolAddress, token0Address, token1Address);
      if (tokenWethPrice > 0) {
        // Get WETH/USDC price
        let wethUsdcPoolAddress: string = ethers.ZeroAddress;
        try {
          const result = await factory.getPool(wethAddress, usdcAddress, FEE_TIER);
          wethUsdcPoolAddress = result && result !== ethers.ZeroAddress ? result : ethers.ZeroAddress;
        } catch (error) {
          // Pool doesn't exist or call failed - this is normal
          wethUsdcPoolAddress = ethers.ZeroAddress;
        }
        
        if (wethUsdcPoolAddress && wethUsdcPoolAddress !== ethers.ZeroAddress) {
          const wethUsdcPool = new ethers.Contract(wethUsdcPoolAddress, UNISWAP_V3_POOL_ABI, provider);
          const wethUsdcToken0 = await wethUsdcPool.token0();
          const wethUsdcToken1 = await wethUsdcPool.token1();
          
          const wethUsdcPrice = await getPoolPrice(provider, wethUsdcPoolAddress, wethUsdcToken0, wethUsdcToken1);
          if (wethUsdcPrice > 0 && isFinite(wethUsdcPrice)) {
            // Calculate token price in USD
            // tokenWethPrice is token1/token0 (in human-readable units)
            // wethUsdcPrice is token1/token0 (in human-readable units)
            
            // Determine token/WETH ratio
            let tokenWethRatio: number;
            if (token0Address.toLowerCase() === tokenAddress.toLowerCase()) {
              // Token is token0, WETH is token1
              // tokenWethPrice = WETH/token, so token/WETH = 1 / tokenWethPrice
              tokenWethRatio = 1 / tokenWethPrice;
            } else {
              // Token is token1, WETH is token0
              // tokenWethPrice = token/WETH, which is what we want
              tokenWethRatio = tokenWethPrice;
            }
            
            // Determine WETH/USDC ratio
            let wethUsdcRatio: number;
            if (wethUsdcToken0.toLowerCase() === wethAddress.toLowerCase()) {
              // WETH is token0, USDC is token1
              // wethUsdcPrice = USDC/WETH, so WETH/USDC = 1 / wethUsdcPrice
              wethUsdcRatio = 1 / wethUsdcPrice;
            } else {
              // WETH is token1, USDC is token0
              // wethUsdcPrice = WETH/USDC, which is what we want
              wethUsdcRatio = wethUsdcPrice;
            }
            
            // Calculate: (token/WETH) * (WETH/USDC) = token/USDC
            const tokenPriceUSD = tokenWethRatio * wethUsdcRatio;
            return isFinite(tokenPriceUSD) && tokenPriceUSD > 0 ? tokenPriceUSD : null;
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
 * Exported for use in other hooks
 */
export async function getCoinGeckoPrice(
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
 */
export function useTokenPrice(): PricingData {
  return usePricingData();
}
