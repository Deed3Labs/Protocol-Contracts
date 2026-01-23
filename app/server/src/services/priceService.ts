import { ethers } from 'ethers';

// Uniswap V3 Factory addresses by chain
const UNISWAP_V3_FACTORY: Record<number, string> = {
  1: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Ethereum Mainnet
  8453: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', // Base Mainnet
  11155111: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c', // Sepolia
  84532: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', // Base Sepolia
  42161: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Arbitrum One
  137: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Polygon
  100: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Gnosis
};

// Common stablecoin addresses
const USDC_ADDRESSES: Record<number, string> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum Mainnet
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base Mainnet
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum One
  137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Polygon
  100: '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83', // Gnosis
};

const WETH_ADDRESSES: Record<number, string> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Ethereum Mainnet (WETH)
  8453: '0x4200000000000000000000000000000000000006', // Base Mainnet (WETH)
  11155111: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // Sepolia (WETH)
  84532: '0x4200000000000000000000000000000000000006', // Base Sepolia (WETH)
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // Arbitrum One (WETH)
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // Polygon (WPOL - wrapped POL, not WETH!)
  100: '0xe91D153E0b41518A2Ce8Dd3D7944F8638934d2C8'.toLowerCase(), // Gnosis (WXDAI) - lowercase to avoid checksum issues
};

const UNISWAP_V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const UNISWAP_V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

const FEE_TIER = 3000; // 0.3% fee tier

/**
 * Get RPC URL for a chain
 */
import { getRpcUrl, getAlchemyNFTUrl } from '../utils/rpc.js';
import { withRetry, createRetryProvider } from '../utils/rpcRetry.js';

/**
 * Get token price with Ethereum mainnet fallback
 * Tries chain-specific pricing first, then falls back to Ethereum mainnet (chainId: 1)
 * 
 * Note: Native tokens (POL, xDAI) use their correct wrapped addresses (WPOL, WXDAI),
 * so they won't accidentally match WETH on Ethereum when falling back.
 */
export async function getTokenPrice(
  chainId: number,
  tokenAddress: string
): Promise<number | null> {
  // First, try chain-specific pricing
  let price: number | null = null;

  // Try Uniswap first (primary on-chain source)
  try {
    price = await getUniswapPrice(chainId, tokenAddress);
  } catch (error) {
    // Silent error, continue to next source
  }

  // Fast fallback to Coinbase if Uniswap fails
  if (!price || price === 0) {
    try {
      price = await getCoinbasePrice(chainId, tokenAddress);
    } catch (error) {
      // Silent error, continue to next source
    }
  }

  // Final fallback to CoinGecko if Uniswap and Coinbase fail
  // CoinGecko has special handling for native tokens (POL, xDAI, etc.)
  if (!price || price === 0) {
    try {
      price = await getCoinGeckoPrice(chainId, tokenAddress);
    } catch (error) {
      // Silent error, continue to Ethereum fallback
    }
  }

  // If we still don't have a price and we're not already on Ethereum mainnet,
  // try fetching from Ethereum mainnet as a fallback
  // Note: Native tokens use correct wrapped addresses (WPOL, WXDAI) so they won't
  // accidentally match WETH on Ethereum
  if ((!price || price === 0) && chainId !== 1) {
    try {
      // Try Ethereum mainnet Uniswap
      price = await getUniswapPrice(1, tokenAddress);
    } catch (error) {
      // Silent error, continue
    }

    // Try Ethereum mainnet Coinbase
    if (!price || price === 0) {
      try {
        price = await getCoinbasePrice(1, tokenAddress);
      } catch (error) {
        // Silent error, continue
      }
    }

    // Try Ethereum mainnet CoinGecko
    if (!price || price === 0) {
      try {
        price = await getCoinGeckoPrice(1, tokenAddress);
      } catch (error) {
        // Silent error
      }
    }
  }

  return price && price > 0 ? price : null;
}

/**
 * Get price from Uniswap V3 pool
 */
export async function getUniswapPrice(
  chainId: number,
  tokenAddress: string
): Promise<number | null> {
  try {
    const factoryAddress = UNISWAP_V3_FACTORY[chainId];
    const usdcAddress = USDC_ADDRESSES[chainId];
    const wethAddress = WETH_ADDRESSES[chainId];

    if (!factoryAddress || !usdcAddress || !wethAddress) {
      return null;
    }

    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      return null;
    }

    // Normalize addresses to proper checksum format
    const normalizedTokenAddress = ethers.getAddress(tokenAddress.toLowerCase());
    const normalizedUsdcAddress = ethers.getAddress(usdcAddress.toLowerCase());
    const normalizedWethAddress = ethers.getAddress(wethAddress.toLowerCase());
    const normalizedFactoryAddress = ethers.getAddress(factoryAddress.toLowerCase());

    // Use retry provider to handle rate limits and network issues
    const provider = createRetryProvider(rpcUrl, chainId);
    const factory = new ethers.Contract(normalizedFactoryAddress, UNISWAP_V3_FACTORY_ABI, provider);

    // Try direct USDC pair first
    let usdcPoolAddress: string = ethers.ZeroAddress;
    try {
      const result = await withRetry(() => factory.getPool(normalizedTokenAddress, normalizedUsdcAddress, FEE_TIER));
      if (result && result !== ethers.ZeroAddress && result !== '0x') {
        usdcPoolAddress = ethers.getAddress(result.toLowerCase());
      }
    } catch (error) {
      usdcPoolAddress = ethers.ZeroAddress;
    }

    if (usdcPoolAddress && usdcPoolAddress !== ethers.ZeroAddress) {
      const pool = new ethers.Contract(usdcPoolAddress, UNISWAP_V3_POOL_ABI, provider);
      // Use retry logic for RPC calls
      const [token0Address, token1Address] = await Promise.all([
        withRetry(() => pool.token0()).then(addr => ethers.getAddress(addr.toLowerCase())),
        withRetry(() => pool.token1()).then(addr => ethers.getAddress(addr.toLowerCase())),
      ]);

      const price = await getPoolPrice(provider, usdcPoolAddress, token0Address, token1Address);
      if (price > 0 && isFinite(price)) {
        if (token0Address.toLowerCase() === normalizedTokenAddress.toLowerCase()) {
          return 1 / price;
        } else {
          return price;
        }
      }
    }

    // Try via WETH if no direct USDC pair
    let wethPoolAddress: string = ethers.ZeroAddress;
    try {
      const result = await withRetry(() => factory.getPool(normalizedTokenAddress, normalizedWethAddress, FEE_TIER));
      wethPoolAddress = result && result !== ethers.ZeroAddress ? ethers.getAddress(result.toLowerCase()) : ethers.ZeroAddress;
    } catch (error) {
      wethPoolAddress = ethers.ZeroAddress;
    }

    if (wethPoolAddress && wethPoolAddress !== ethers.ZeroAddress) {
      const pool = new ethers.Contract(wethPoolAddress, UNISWAP_V3_POOL_ABI, provider);
      // Use retry logic for RPC calls
      const [token0Address, token1Address] = await Promise.all([
        withRetry(() => pool.token0()).then(addr => ethers.getAddress(addr.toLowerCase())),
        withRetry(() => pool.token1()).then(addr => ethers.getAddress(addr.toLowerCase())),
      ]);

      const tokenWethPrice = await getPoolPrice(provider, wethPoolAddress, token0Address, token1Address);
      if (tokenWethPrice > 0) {
        let wethUsdcPoolAddress: string = ethers.ZeroAddress;
        try {
          const result = await withRetry(() => factory.getPool(normalizedWethAddress, normalizedUsdcAddress, FEE_TIER));
          wethUsdcPoolAddress = result && result !== ethers.ZeroAddress ? ethers.getAddress(result.toLowerCase()) : ethers.ZeroAddress;
        } catch (error) {
          wethUsdcPoolAddress = ethers.ZeroAddress;
        }

        if (wethUsdcPoolAddress && wethUsdcPoolAddress !== ethers.ZeroAddress) {
          const wethUsdcPool = new ethers.Contract(wethUsdcPoolAddress, UNISWAP_V3_POOL_ABI, provider);
          // Use retry logic for RPC calls
          const [wethUsdcToken0, wethUsdcToken1] = await Promise.all([
            withRetry(() => wethUsdcPool.token0()).then(addr => ethers.getAddress(addr.toLowerCase())),
            withRetry(() => wethUsdcPool.token1()).then(addr => ethers.getAddress(addr.toLowerCase())),
          ]);

          const wethUsdcPrice = await getPoolPrice(provider, wethUsdcPoolAddress, wethUsdcToken0, wethUsdcToken1);
          if (wethUsdcPrice > 0 && isFinite(wethUsdcPrice)) {
            let tokenWethRatio: number;
            if (token0Address.toLowerCase() === normalizedTokenAddress.toLowerCase()) {
              tokenWethRatio = 1 / tokenWethPrice;
            } else {
              tokenWethRatio = tokenWethPrice;
            }

            let wethUsdcRatio: number;
            if (wethUsdcToken0.toLowerCase() === normalizedWethAddress.toLowerCase()) {
              wethUsdcRatio = 1 / wethUsdcPrice;
            } else {
              wethUsdcRatio = wethUsdcPrice;
            }

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
 * Map token symbols to Coinbase currency pairs
 * Coinbase uses format like ETH-USD, MATIC-USD, etc.
 */
function getCoinbaseCurrencyPair(symbol: string): string | null {
  const normalizedSymbol = symbol?.toUpperCase() || '';
  
  // Map common tokens to Coinbase pairs
  const symbolMap: Record<string, string> = {
    'ETH': 'ETH-USD',
    'WETH': 'ETH-USD', // Wrapped ETH uses ETH price
    'POL': 'POL-USD', // POL (Polygon native token, upgraded from MATIC)
    'MATIC': 'POL-USD', // Legacy MATIC uses POL price (they're the same token)
    'WMATIC': 'POL-USD', // Wrapped MATIC uses POL price
    'WPOL': 'POL-USD', // Wrapped POL uses POL price
    'XDAI': 'XDAI-USD',
    'WXDAI': 'XDAI-USD', // Wrapped xDAI uses xDAI price
    'BTC': 'BTC-USD',
    'WBTC': 'BTC-USD',
    'USDC': 'USDC-USD',
    'USDT': 'USDT-USD',
    'DAI': 'DAI-USD',
    'LINK': 'LINK-USD',
    'UNI': 'UNI-USD',
    'AAVE': 'AAVE-USD',
    'CRV': 'CRV-USD',
    'MKR': 'MKR-USD',
    'SNX': 'SNX-USD',
    'COMP': 'COMP-USD',
    'YFI': 'YFI-USD',
    'SUSHI': 'SUSHI-USD',
    '1INCH': '1INCH-USD',
    'BAL': 'BAL-USD',
    'ZRX': 'ZRX-USD',
  };
  
  // Check direct mapping first
  if (symbolMap[normalizedSymbol]) {
    return symbolMap[normalizedSymbol];
  }
  
  // For other tokens, return null (Coinbase may not support them)
  return null;
}

/**
 * Get token symbol from contract address
 */
async function getTokenSymbol(
  chainId: number,
  tokenAddress: string
): Promise<string | null> {
  try {
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      return null;
    }

    // Normalize address to proper checksum format
    const normalizedTokenAddress = ethers.getAddress(tokenAddress.toLowerCase());

    // Use retry provider to handle rate limits and network issues
    const provider = createRetryProvider(rpcUrl, chainId);
    const tokenContract = new ethers.Contract(normalizedTokenAddress, ERC20_ABI, provider);
    const symbol = await withRetry(() => tokenContract.symbol());
    return symbol || null;
  } catch (error) {
    return null;
  }
}

/**
 * Get price from Coinbase API
 * Fast, free, no authentication required
 * Returns spot price for currency pair
 */
export async function getCoinbasePrice(
  chainId: number,
  tokenAddress: string
): Promise<number | null> {
  try {
    // Get token symbol first
    const symbol = await getTokenSymbol(chainId, tokenAddress);
    if (!symbol) {
      return null; // Can't get symbol, can't use Coinbase
    }

    const currencyPair = getCoinbaseCurrencyPair(symbol);
    if (!currencyPair) {
      return null; // Symbol not supported by Coinbase
    }
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    try {
      const response = await fetch(
        `https://api.coinbase.com/v2/prices/${currencyPair}/spot`,
        { 
          method: 'GET',
          signal: controller.signal
        }
      );
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return null;
      }
      
      const data = await response.json() as { data?: { amount?: string } };
      const price = parseFloat(data?.data?.amount || '0');
      
      if (price && price > 0 && isFinite(price)) {
        return price;
      }
      
      return null;
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      // Handle timeout or other fetch errors silently
      if (fetchError.name === 'AbortError') {
        // Timeout - silent error
        return null;
      }
      // Other fetch errors - return null to fall back
      return null;
    }
  } catch (error) {
    // Silent error - Coinbase API might be down or symbol not supported
    return null;
  }
}

/**
 * Get price from CoinGecko API
 */
export async function getCoinGeckoPrice(
  chainId: number,
  tokenAddress: string
): Promise<number | null> {
  try {
    const platformMap: Record<number, string> = {
      1: 'ethereum',
      8453: 'base',
      11155111: 'ethereum',
      84532: 'base',
      42161: 'arbitrum-one',
      137: 'polygon-pos',
      100: 'xdai',
    };

    const platform = platformMap[chainId];
    if (!platform) return null;

    // Handle native tokens with specific CoinGecko IDs
    const wethAddress = WETH_ADDRESSES[chainId];
    if (tokenAddress.toLowerCase() === wethAddress.toLowerCase()) {
      // Map chain IDs to native token CoinGecko IDs
      const nativeTokenIds: Record<number, string> = {
        1: 'ethereum', // ETH
        8453: 'ethereum', // ETH (Base)
        11155111: 'ethereum', // ETH (Sepolia)
        84532: 'ethereum', // ETH (Base Sepolia)
        42161: 'ethereum', // ETH (Arbitrum)
        137: 'pol-ex-matic', // POL (Polygon - upgraded from MATIC)
        100: 'xdai', // xDAI (Gnosis)
      };

      const nativeTokenId = nativeTokenIds[chainId];
      if (nativeTokenId) {
        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${nativeTokenId}&vs_currencies=usd`,
          { method: 'GET' }
        );

        if (response.ok) {
          const data = await response.json() as Record<string, { usd?: number }>;
          return data[nativeTokenId]?.usd || null;
        }
      }
    }

    const apiKey = process.env.COINGECKO_API_KEY;
    const url = apiKey
      ? `https://pro-api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${tokenAddress}&vs_currencies=usd&x_cg_pro_api_key=${apiKey}`
      : `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${tokenAddress}&vs_currencies=usd`;

    const response = await fetch(url, { method: 'GET' });

    if (response.ok) {
      const data = await response.json() as Record<string, { usd?: number }>;
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
 * Helper function to get pool price
 */
async function getPoolPrice(
  provider: ethers.Provider,
  poolAddress: string,
  token0Address: string,
  token1Address: string
): Promise<number> {
  try {
    // Normalize addresses to proper checksum format
    const normalizedPoolAddress = ethers.getAddress(poolAddress.toLowerCase());
    const normalizedToken0Address = ethers.getAddress(token0Address.toLowerCase());
    const normalizedToken1Address = ethers.getAddress(token1Address.toLowerCase());
    
    const pool = new ethers.Contract(normalizedPoolAddress, UNISWAP_V3_POOL_ABI, provider);
    // Use retry logic for RPC calls
    const slot0 = await withRetry(() => pool.slot0());
    const sqrtPriceX96 = slot0[0];

    const token0 = new ethers.Contract(normalizedToken0Address, ERC20_ABI, provider);
    const token1 = new ethers.Contract(normalizedToken1Address, ERC20_ABI, provider);
    // Use retry logic for RPC calls
    const [decimals0, decimals1] = await Promise.all([
      withRetry(() => token0.decimals()).then(d => Number(d)),
      withRetry(() => token1.decimals()).then(d => Number(d)),
    ]);

    const sqrtPrice = BigInt(sqrtPriceX96.toString());
    const Q96 = 2n ** 96n;

    const numerator = sqrtPrice * sqrtPrice;
    const denominator = Q96 * Q96;

    const INTERMEDIATE_SCALE = 10n ** 36n;
    const scaledRatio = (numerator * INTERMEDIATE_SCALE) / denominator;

    let adjustedRatio = scaledRatio;

    if (decimals0 > decimals1) {
      const decimalDiff = decimals0 - decimals1;
      const decimalFactor = 10n ** BigInt(decimalDiff);
      adjustedRatio = adjustedRatio / decimalFactor;
    } else if (decimals1 > decimals0) {
      const decimalDiff = decimals1 - decimals0;
      const decimalFactor = 10n ** BigInt(decimalDiff);
      adjustedRatio = adjustedRatio * decimalFactor;
    }

    if (adjustedRatio === 0n) {
      return 0;
    }

    // Convert BigInt to number safely
    // Price = adjustedRatio / INTERMEDIATE_SCALE
    // To avoid overflow, we'll scale down both values proportionally before converting to numbers
    
    // Scale down factor: we'll divide both by 10^18 to bring them into safe number range
    const SCALE_DOWN = 10n ** 18n;
    const SCALED_INTERMEDIATE = INTERMEDIATE_SCALE / SCALE_DOWN; // Should be 10^18
    
    // Scale down adjustedRatio
    const scaledDownRatio = adjustedRatio / SCALE_DOWN;
    
    // Now both values should be in a safe range for number conversion
    // But we need to handle the case where adjustedRatio < SCALE_DOWN
    // In that case, we'll use a different approach
    
    let price: number;
    
    if (adjustedRatio < SCALE_DOWN) {
      // If adjustedRatio is small, we can convert directly and divide
      const ratioNum = Number(adjustedRatio);
      const scaleNum = Number(INTERMEDIATE_SCALE);
      price = ratioNum / scaleNum;
    } else {
      // Scale down both numerator and denominator
      const scaledRatioNum = Number(scaledDownRatio);
      const scaledScaleNum = Number(SCALED_INTERMEDIATE);
      price = scaledRatioNum / scaledScaleNum;
    }

    // Validate the result
    if (!isFinite(price) || price <= 0 || price > 1e10 || price < 1e-10) {
      // Log the raw values for debugging
      const ratioString = adjustedRatio.toString();
      console.error('Price calculation error: invalid price', price, 'raw ratio:', ratioString);
      return 0;
    }

    return price;
  } catch (error) {
    console.error('Error getting pool price:', error);
    return 0;
  }
}

/**
 * Map chain IDs to OpenSea chain identifiers
 */
const OPENSEA_CHAIN_MAP: Record<number, string> = {
  1: 'ethereum',
  8453: 'base',
  11155111: 'ethereum-sepolia',
  84532: 'base-sepolia',
  42161: 'arbitrum',
  137: 'matic',
  100: 'gnosis',
};

/**
 * Get NFT collection floor price from Alchemy NFT API
 * @param chainId - Chain ID
 * @param contractAddress - NFT contract address
 * @returns Floor price in USD, or null if not available
 */
export async function getAlchemyNFTFloorPrice(
  chainId: number,
  contractAddress: string
): Promise<number | null> {
  try {
    const alchemyNFTUrl = getAlchemyNFTUrl(chainId);
    if (!alchemyNFTUrl) {
      return null; // Alchemy NFT API not available for this chain
    }

    // Normalize contract address
    const normalizedAddress = ethers.getAddress(contractAddress.toLowerCase());

    // Alchemy NFT API v3: Get floor price
    // Note: This endpoint is primarily available on Ethereum mainnet
    // For other chains, we may need to use different endpoints or fallback to OpenSea
    const url = `${alchemyNFTUrl}/getFloorPrice?contractAddress=${normalizedAddress}`;

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as {
        openSea?: {
          floorPrice?: number;
          priceCurrency?: string;
        };
        looksRare?: {
          floorPrice?: number;
          priceCurrency?: string;
        };
      };

      // Get floor price from OpenSea (primary) or LooksRare (fallback)
      const marketplace = data.openSea || data.looksRare;
      if (!marketplace || !marketplace.floorPrice || marketplace.floorPrice === 0) {
        return null;
      }

      // Floor price is in ETH (or native token)
      // Convert to USD using native token price
      const floorPriceNative = marketplace.floorPrice;
      
      // Get native token price (ETH, BASE, etc.)
      const nativeTokenAddress = WETH_ADDRESSES[chainId];
      if (!nativeTokenAddress) {
        return null;
      }

      const nativeTokenPrice = await getTokenPrice(chainId, nativeTokenAddress);
      if (!nativeTokenPrice || nativeTokenPrice === 0) {
        return null;
      }

      // Floor price in USD = floor price in native token * native token price
      const floorPriceUSD = floorPriceNative * nativeTokenPrice;

      return floorPriceUSD > 0 && isFinite(floorPriceUSD) ? floorPriceUSD : null;
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      // Handle timeout or other fetch errors silently
      if (fetchError.name === 'AbortError') {
        // Timeout - silent error
        return null;
      }
      // Other fetch errors - return null to fall back
      return null;
    }
  } catch (error) {
    // Silent error - Alchemy NFT API might be down or collection not listed
    return null;
  }
}

/**
 * Get NFT collection floor price from OpenSea API (fallback)
 * @param chainId - Chain ID
 * @param contractAddress - NFT contract address
 * @returns Floor price in USD, or null if not available
 */
export async function getOpenSeaNFTPrice(
  chainId: number,
  contractAddress: string
): Promise<number | null> {
  try {
    const openseaChain = OPENSEA_CHAIN_MAP[chainId];
    if (!openseaChain) {
      return null; // Chain not supported by OpenSea
    }

    const apiKey = process.env.OPENSEA_API_KEY;
    if (!apiKey) {
      // OpenSea API requires an API key for production use
      // Free tier: https://docs.opensea.io/reference/api-overview
      return null;
    }

    // Normalize contract address
    const normalizedAddress = ethers.getAddress(contractAddress.toLowerCase());

    // OpenSea API v2 endpoint for collection stats
    // Note: We need the collection slug, but we can try to get it from the contract address
    // Alternative: Use the contract address directly if OpenSea supports it
    
    // Try to get collection stats using contract address
    // OpenSea API v2: https://api.opensea.io/api/v2/chain/{chain}/contract/{contract_address}/nfts/{identifier}/listings
    // For floor price, we can use: https://api.opensea.io/api/v2/chain/{chain}/collection/{collection_slug}/stats
    
    // Since we don't have the collection slug, we'll use a different approach:
    // Get the floor price from the collection's stats endpoint
    // But we need the collection slug, which requires an additional lookup
    
    // Alternative: Use OpenSea's collection endpoint with contract address
    // https://api.opensea.io/api/v2/chain/{chain}/contract/{contract_address}/nfts?limit=1
    // Then get collection slug from the response
    
    // For now, let's use a simpler approach: get collection stats if we can determine the slug
    // Or use the contract address directly in a collection lookup
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    try {
      // OpenSea API v2: Get collection stats by contract address
      // First, try to get collection identifier from contract
      // OpenSea v2 supports direct contract lookup for some chains
      
      // Method 1: Try to get collection stats directly using contract address
      // Note: OpenSea API v2 structure may vary by chain
      // For Ethereum mainnet, we can use: /api/v2/chain/ethereum/contract/{address}/nfts?limit=1
      // Then extract collection slug from the response
      
      // Try to get a sample NFT from the collection to find the collection slug
      const sampleNftUrl = `https://api.opensea.io/api/v2/chain/${openseaChain}/contract/${normalizedAddress}/nfts?limit=1`;
      const sampleResponse = await fetch(sampleNftUrl, {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!sampleResponse.ok) {
        return null;
      }

      const sampleData = await sampleResponse.json() as {
        nfts?: Array<{ collection?: string }>;
        next?: string;
      };

      // Extract collection identifier from the first NFT
      const collectionIdentifier = sampleData.nfts?.[0]?.collection;
      if (!collectionIdentifier) {
        return null;
      }

      // Get collection stats (includes floor price)
      // OpenSea API v2: /api/v2/collections/{collection_identifier}/stats
      const statsUrl = `https://api.opensea.io/api/v2/collections/${collectionIdentifier}/stats`;
      const statsController = new AbortController();
      const statsTimeoutId = setTimeout(() => statsController.abort(), 5000);

      try {
        const statsResponse = await fetch(statsUrl, {
          method: 'GET',
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
          signal: statsController.signal,
        });

        clearTimeout(statsTimeoutId);

        if (!statsResponse.ok) {
          return null;
        }

        const statsData = await statsResponse.json() as {
          total?: { floor_price?: number };
          floor_price?: number;
          statistics?: { floor_price?: number };
        };

        // OpenSea returns floor price in native token, we need to convert to USD
        // The floor_price might be in ETH or other native tokens
        const floorPriceNative = statsData.total?.floor_price 
          || statsData.floor_price 
          || statsData.statistics?.floor_price;
        
        if (!floorPriceNative || floorPriceNative === 0) {
          return null;
        }

        // Convert native token price to USD
        // Get native token price (ETH, POL, etc.)
        const nativeTokenAddress = WETH_ADDRESSES[chainId];
        if (!nativeTokenAddress) {
          return null;
        }

        const nativeTokenPrice = await getTokenPrice(chainId, nativeTokenAddress);
        if (!nativeTokenPrice || nativeTokenPrice === 0) {
          return null;
        }

        // Floor price in USD = floor price in native token * native token price
        const floorPriceUSD = floorPriceNative * nativeTokenPrice;

        return floorPriceUSD > 0 && isFinite(floorPriceUSD) ? floorPriceUSD : null;
      } catch (statsError: any) {
        clearTimeout(statsTimeoutId);
        if (statsError.name !== 'AbortError') {
          // Silent error for timeout, log others
          console.error('OpenSea stats fetch error:', statsError);
        }
        return null;
      }
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      // Handle timeout or other fetch errors silently
      if (fetchError.name === 'AbortError') {
        // Timeout - silent error
        return null;
      }
      // Other fetch errors - return null to fall back
      return null;
    }
  } catch (error) {
    // Silent error - OpenSea API might be down or collection not listed
    return null;
  }
}

/**
 * Get NFT collection floor price (primary: Alchemy, fallback: OpenSea)
 * This is the main function to use for NFT pricing
 * @param chainId - Chain ID
 * @param contractAddress - NFT contract address
 * @returns Floor price in USD, or null if not available
 */
export async function getNFTFloorPrice(
  chainId: number,
  contractAddress: string
): Promise<number | null> {
  // Try Alchemy NFT API first (faster, more reliable, works on Ethereum mainnet)
  let price = await getAlchemyNFTFloorPrice(chainId, contractAddress);
  
  // Fallback to OpenSea if Alchemy fails or not available
  if (!price || price === 0) {
    price = await getOpenSeaNFTPrice(chainId, contractAddress);
  }
  
  return price;
}
