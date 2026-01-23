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
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Ethereum Mainnet
  8453: '0x4200000000000000000000000000000000000006', // Base Mainnet
  11155111: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // Sepolia
  84532: '0x4200000000000000000000000000000000000006', // Base Sepolia
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // Arbitrum One
  137: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // Polygon (WETH)
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
import { getRpcUrl } from '../utils/rpc.js';
import { withRetry, createRetryProvider } from '../utils/rpcRetry.js';

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

    // Convert BigInt to number safely to avoid precision loss
    // Use string conversion to handle large numbers properly
    const ratioString = adjustedRatio.toString();
    const scaleString = INTERMEDIATE_SCALE.toString();
    
    // Calculate price using string division to maintain precision
    // For very large numbers, we need to be careful with division
    const ratioNum = parseFloat(ratioString);
    const scaleNum = parseFloat(scaleString);
    
    // If the number is too large, we need to scale it down first
    if (ratioNum > Number.MAX_SAFE_INTEGER) {
      // Scale down by dividing both numerator and denominator
      const scaleDown = 1e18; // Scale down by 1e18
      const scaledRatio = ratioNum / scaleDown;
      const scaledScale = scaleNum / scaleDown;
      const price = scaledRatio / scaledScale;
      
      if (!isFinite(price) || price <= 0 || price > 1e10 || price < 1e-10) {
        console.error('Price calculation error: invalid price after scaling', price, 'raw ratio:', ratioString);
        return 0;
      }
      return price;
    }
    
    const price = ratioNum / scaleNum;

    if (!isFinite(price) || price <= 0 || price > 1e10 || price < 1e-10) {
      console.error('Price calculation error: invalid price', price, 'raw ratio:', ratioString);
      return 0;
    }

    return price;
  } catch (error) {
    console.error('Error getting pool price:', error);
    return 0;
  }
}
