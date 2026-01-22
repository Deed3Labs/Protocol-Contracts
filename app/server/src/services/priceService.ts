import { ethers } from 'ethers';

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
  8453: '0x4200000000000000000000000000000000000006', // Base Mainnet
  11155111: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // Sepolia
  84532: '0x4200000000000000000000000000000000000006', // Base Sepolia
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
function getRpcUrl(chainId: number): string {
  // You can add your RPC URLs here or use environment variables
  const rpcUrls: Record<number, string> = {
    1: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    8453: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    11155111: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
    84532: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
  };

  return rpcUrls[chainId] || '';
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

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const factory = new ethers.Contract(factoryAddress, UNISWAP_V3_FACTORY_ABI, provider);

    // Try direct USDC pair first
    let usdcPoolAddress: string = ethers.ZeroAddress;
    try {
      const result = await factory.getPool(tokenAddress, usdcAddress, FEE_TIER);
      if (result && result !== ethers.ZeroAddress && result !== '0x') {
        usdcPoolAddress = result;
      }
    } catch (error) {
      usdcPoolAddress = ethers.ZeroAddress;
    }

    if (usdcPoolAddress && usdcPoolAddress !== ethers.ZeroAddress) {
      const pool = new ethers.Contract(usdcPoolAddress, UNISWAP_V3_POOL_ABI, provider);
      const token0Address = await pool.token0();
      const token1Address = await pool.token1();

      const price = await getPoolPrice(provider, usdcPoolAddress, token0Address, token1Address);
      if (price > 0 && isFinite(price)) {
        if (token0Address.toLowerCase() === tokenAddress.toLowerCase()) {
          return 1 / price;
        } else {
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
      wethPoolAddress = ethers.ZeroAddress;
    }

    if (wethPoolAddress && wethPoolAddress !== ethers.ZeroAddress) {
      const pool = new ethers.Contract(wethPoolAddress, UNISWAP_V3_POOL_ABI, provider);
      const token0Address = await pool.token0();
      const token1Address = await pool.token1();

      const tokenWethPrice = await getPoolPrice(provider, wethPoolAddress, token0Address, token1Address);
      if (tokenWethPrice > 0) {
        let wethUsdcPoolAddress: string = ethers.ZeroAddress;
        try {
          const result = await factory.getPool(wethAddress, usdcAddress, FEE_TIER);
          wethUsdcPoolAddress = result && result !== ethers.ZeroAddress ? result : ethers.ZeroAddress;
        } catch (error) {
          wethUsdcPoolAddress = ethers.ZeroAddress;
        }

        if (wethUsdcPoolAddress && wethUsdcPoolAddress !== ethers.ZeroAddress) {
          const wethUsdcPool = new ethers.Contract(wethUsdcPoolAddress, UNISWAP_V3_POOL_ABI, provider);
          const wethUsdcToken0 = await wethUsdcPool.token0();
          const wethUsdcToken1 = await wethUsdcPool.token1();

          const wethUsdcPrice = await getPoolPrice(provider, wethUsdcPoolAddress, wethUsdcToken0, wethUsdcToken1);
          if (wethUsdcPrice > 0 && isFinite(wethUsdcPrice)) {
            let tokenWethRatio: number;
            if (token0Address.toLowerCase() === tokenAddress.toLowerCase()) {
              tokenWethRatio = 1 / tokenWethPrice;
            } else {
              tokenWethRatio = tokenWethPrice;
            }

            let wethUsdcRatio: number;
            if (wethUsdcToken0.toLowerCase() === wethAddress.toLowerCase()) {
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
    };

    const platform = platformMap[chainId];
    if (!platform) return null;

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

    const apiKey = process.env.COINGECKO_API_KEY;
    const url = apiKey
      ? `https://pro-api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${tokenAddress}&vs_currencies=usd&x_cg_pro_api_key=${apiKey}`
      : `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${tokenAddress}&vs_currencies=usd`;

    const response = await fetch(url, { method: 'GET' });

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
 * Helper function to get pool price
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
    const sqrtPriceX96 = slot0[0];

    const token0 = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1 = new ethers.Contract(token1Address, ERC20_ABI, provider);
    const decimals0 = Number(await token0.decimals());
    const decimals1 = Number(await token1.decimals());

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

    let price = Number(adjustedRatio) / Number(INTERMEDIATE_SCALE);

    if (!isFinite(price) || price <= 0 || price > 1e10 || price < 1e-10) {
      if (!isFinite(price) || price <= 0 || price > 1e10) {
        console.error('Price calculation error: invalid price', price);
      }
      return 0;
    }

    return price;
  } catch (error) {
    console.error('Error getting pool price:', error);
    return 0;
  }
}
