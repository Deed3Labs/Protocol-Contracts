import { ethers } from 'ethers';
import { 
  getAlchemyPricesApiUrl, 
  getAlchemyApiKey, 
  getAlchemyNetworkName,
  getAlchemyNFTUrl 
} from '../utils/rpc.js';
import { computeUnitTracker } from '../utils/computeUnitTracker.js';

// Common stablecoin addresses for quick price checks
const STABLECOIN_ADDRESSES = new Set([
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC Ethereum
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC Base
  '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238', // USDC Sepolia
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e', // USDC Base Sepolia
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC Arbitrum
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // USDC Polygon
  '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83', // USDC Gnosis
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT Ethereum
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI Ethereum
].map(addr => addr.toLowerCase()));

/**
 * Get token price using Alchemy Prices API
 * Primary method: Alchemy Prices API (by address)
 * Fallback: Alchemy Prices API (by symbol) if we can get token symbol
 * 
 * NOTE: This service is used for:
 * - Standalone price queries (/api/prices endpoint)
 * - Background price updater job (caching common token prices)
 * - WebSocket price updates
 * - When Portfolio API isn't used (old endpoints)
 * 
 * For Portfolio API endpoints (/api/token-balances/portfolio), prices are
 * already included in the response via tokenPrices field, so this service
 * is not needed for those queries.
 * 
 * @param chainId - Chain ID
 * @param tokenAddress - Token contract address
 * @returns Price in USD, or null if not available
 */
export async function getTokenPrice(
  chainId: number,
  tokenAddress: string
): Promise<number | null> {
  // Quick check: stablecoins are always $1
  const normalizedAddress = tokenAddress.toLowerCase();
  if (STABLECOIN_ADDRESSES.has(normalizedAddress)) {
    return 1.0;
  }

  // Try Alchemy Prices API by address (primary method)
  let price = await getAlchemyPriceByAddress(chainId, tokenAddress);
  
  if (price && price > 0) {
    return price;
  }

  // Fallback: Try by symbol if we can get token symbol
  // This is useful for native tokens or tokens that might not be indexed by address
  try {
    const symbol = await getTokenSymbol(chainId, tokenAddress);
    if (symbol) {
      price = await getAlchemyPriceBySymbol(symbol);
      if (price && price > 0) {
        return price;
      }
    }
  } catch (error) {
    // Silent error, continue
  }

  // If still no price and not on Ethereum mainnet, try Ethereum mainnet as fallback
  if ((!price || price === 0) && chainId !== 1) {
    price = await getAlchemyPriceByAddress(1, tokenAddress);
    if (price && price > 0) {
      return price;
    }
  }

  return price && price > 0 ? price : null;
}

/**
 * Get token prices from Alchemy Prices API by address (supports batch)
 * https://www.alchemy.com/docs/reference/get-token-prices-by-address
 * 
 * @param requests - Array of { chainId, tokenAddress } to fetch prices for
 * @returns Map of `${chainId}:${tokenAddressLower}` -> price
 */
export async function getAlchemyPricesBatch(
  requests: Array<{ chainId: number; tokenAddress: string }>
): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  
  if (requests.length === 0) {
    return priceMap;
  }

  try {
    const apiUrl = getAlchemyPricesApiUrl();
    const apiKey = getAlchemyApiKey();

    if (!apiUrl || !apiKey) {
      return priceMap;
    }

    // Group requests by network (chainId -> networkName)
    const requestsByNetwork = new Map<string, Array<{ address: string; originalRequest: { chainId: number; tokenAddress: string } }>>();
    
    for (const { chainId, tokenAddress } of requests) {
      const networkName = getAlchemyNetworkName(chainId);
      if (!networkName) continue;

      const normalizedAddress = ethers.getAddress(tokenAddress.toLowerCase());
      const key = `${networkName}`;
      
      if (!requestsByNetwork.has(key)) {
        requestsByNetwork.set(key, []);
      }
      requestsByNetwork.get(key)!.push({
        address: normalizedAddress,
        originalRequest: { chainId, tokenAddress },
      });
    }

    // Fetch prices for each network in parallel (but batch addresses per network)
    const fetchPromises = Array.from(requestsByNetwork.entries()).map(async ([networkName, addressList]) => {
      try {
        // Alchemy Prices API supports batching multiple addresses in one request
        const response = await fetch(`${apiUrl}/tokens/by-address`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            addresses: addressList.map(item => ({
              network: networkName,
              address: item.address,
            })),
          }),
        });

        if (!response.ok) {
          return new Map<string, number>();
        }

        const data = await response.json() as {
          data?: Array<{
            address?: string;
            network?: string;
            prices?: Array<{
              currency: string;
              value: string;
              lastUpdatedAt: string;
            }>;
            error?: string | null;
          }>;
        };

        const networkPriceMap = new Map<string, number>();
        if (data.data) {
          for (let i = 0; i < data.data.length; i++) {
            const tokenData = data.data[i];
            const originalRequest = addressList[i]?.originalRequest;
            
            if (!originalRequest || tokenData.error || !tokenData.prices || tokenData.prices.length === 0) {
              continue;
            }

            const usdPrice = tokenData.prices.find(p => p.currency === 'USD') || tokenData.prices[0];
            if (usdPrice?.value) {
              const price = parseFloat(usdPrice.value);
              if (price && price > 0 && isFinite(price)) {
                networkPriceMap.set(
                  `${originalRequest.chainId}:${originalRequest.tokenAddress.toLowerCase()}`,
                  price
                );
              }
            }
          }
        }
        
        return networkPriceMap;
      } catch (error) {
        return new Map<string, number>();
      }
    });

    const networkResults = await Promise.all(fetchPromises);
    for (const networkMap of networkResults) {
      for (const [address, price] of networkMap.entries()) {
        priceMap.set(address, price);
      }
    }

    return priceMap;
  } catch (error) {
    return priceMap;
  }
}

/**
 * Get token price from Alchemy Prices API by address
 * https://www.alchemy.com/docs/reference/get-token-prices-by-address
 */
async function getAlchemyPriceByAddress(
  chainId: number,
  tokenAddress: string
): Promise<number | null> {
  try {
    const apiUrl = getAlchemyPricesApiUrl();
    const apiKey = getAlchemyApiKey();
    const networkName = getAlchemyNetworkName(chainId);

    if (!apiUrl || !apiKey || !networkName) {
      return null;
    }

    // Normalize address
    const normalizedAddress = ethers.getAddress(tokenAddress.toLowerCase());

    // Track compute units before making the call
    computeUnitTracker.logApiCall(
      'alchemy_prices_by_address',
      'getAlchemyPriceByAddress',
      { chainId, estimatedUnits: 15 }
    );

    // Alchemy Prices API by address endpoint (supports single or batch)
    const response = await fetch(`${apiUrl}/tokens/by-address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        addresses: [
          {
            network: networkName,
            address: normalizedAddress,
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      data?: Array<{
        address?: string;
        network?: string;
        prices?: Array<{
          currency: string;
          value: string;
          lastUpdatedAt: string;
        }>;
        error?: string | null;
      }>;
    };

    const tokenData = data.data?.[0];
    if (!tokenData || tokenData.error || !tokenData.prices || tokenData.prices.length === 0) {
      return null;
    }

    // Get USD price (first price in array is typically USD)
    const usdPrice = tokenData.prices.find(p => p.currency === 'USD') || tokenData.prices[0];
    if (!usdPrice || !usdPrice.value) {
      return null;
    }

    const price = parseFloat(usdPrice.value);
    return price && price > 0 && isFinite(price) ? price : null;
  } catch (error) {
    // Silent error - Alchemy API might be unavailable
    return null;
  }
}

/**
 * Get token price from Alchemy Prices API by symbol
 * https://www.alchemy.com/docs/reference/get-token-prices-by-symbol
 */
async function getAlchemyPriceBySymbol(symbol: string): Promise<number | null> {
  try {
    const apiUrl = getAlchemyPricesApiUrl();
    const apiKey = getAlchemyApiKey();

    if (!apiUrl || !apiKey) {
      return null;
    }

    // Normalize symbol
    const normalizedSymbol = symbol.toUpperCase();

    // Track compute units before making the call
    computeUnitTracker.logApiCall(
      'alchemy_prices_by_symbol',
      'getAlchemyPriceBySymbol',
      { estimatedUnits: 15 }
    );

    // Alchemy Prices API by symbol endpoint
    const response = await fetch(`${apiUrl}/tokens/by-symbol?symbols=${normalizedSymbol}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      data?: Array<{
        symbol?: string;
        prices?: Array<{
          currency: string;
          value: string;
          lastUpdatedAt: string;
        }>;
        error?: string | null;
      }>;
    };

    const tokenData = data.data?.find(t => t.symbol?.toUpperCase() === normalizedSymbol);
    if (!tokenData || tokenData.error || !tokenData.prices || tokenData.prices.length === 0) {
      return null;
    }

    // Get USD price (first price in array is typically USD)
    const usdPrice = tokenData.prices.find(p => p.currency === 'USD') || tokenData.prices[0];
    if (!usdPrice || !usdPrice.value) {
      return null;
    }

    const price = parseFloat(usdPrice.value);
    return price && price > 0 && isFinite(price) ? price : null;
  } catch (error) {
    // Silent error - Alchemy API might be unavailable
    return null;
  }
}

/**
 * Get token symbol from contract address
 * Used as fallback when address-based pricing fails
 */
async function getTokenSymbol(
  chainId: number,
  tokenAddress: string
): Promise<string | null> {
  try {
    // Import here to avoid circular dependencies
    const { getRpcUrl } = await import('../utils/rpc.js');
    const { createRetryProvider } = await import('../utils/rpcRetry.js');
    
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      return null;
    }

    const normalizedAddress = ethers.getAddress(tokenAddress.toLowerCase());
    const provider = createRetryProvider(rpcUrl, chainId);
    
    const ERC20_ABI = [
      'function symbol() external view returns (string)',
    ];
    
    const tokenContract = new ethers.Contract(normalizedAddress, ERC20_ABI, provider);
    const symbol = await tokenContract.symbol();
    return symbol || null;
  } catch (error) {
    return null;
  }
}

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
      // For Ethereum mainnet, use WETH address
      const nativeTokenAddress = chainId === 1 
        ? '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' // WETH
        : null;
      
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
  // Note: OpenSea implementation removed for simplification - can be added back if needed
  // if (!price || price === 0) {
  //   price = await getOpenSeaNFTPrice(chainId, contractAddress);
  // }
  
  return price;
}

// Legacy exports for backward compatibility (deprecated - use getTokenPrice instead)
export async function getUniswapPrice(
  chainId: number,
  tokenAddress: string
): Promise<number | null> {
  // Deprecated: Use getTokenPrice which uses Alchemy Prices API
  return getTokenPrice(chainId, tokenAddress);
}

export async function getCoinbasePrice(
  chainId: number,
  tokenAddress: string
): Promise<number | null> {
  // Deprecated: Use getTokenPrice which uses Alchemy Prices API
  return getTokenPrice(chainId, tokenAddress);
}

export async function getCoinGeckoPrice(
  chainId: number,
  tokenAddress: string
): Promise<number | null> {
  // Deprecated: Use getTokenPrice which uses Alchemy Prices API
  return getTokenPrice(chainId, tokenAddress);
}
