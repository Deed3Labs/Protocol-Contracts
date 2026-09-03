import { ethers } from 'ethers';
import { getAlchemyPortfolioApiUrl, getAlchemyNetworkName } from '../utils/rpc.js';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { computeUnitTracker } from '../utils/computeUnitTracker.js';

/**
 * Rate limiter for Alchemy Portfolio API calls
 * Limits to ~5 requests per second to avoid rate limits
 */
class PortfolioRateLimiter {
  private lastRequestTime: number = 0;
  private readonly minDelayMs = 200; // 200ms between requests = ~5 req/sec max

  async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minDelayMs) {
      const waitTime = this.minDelayMs - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }
}

const portfolioRateLimiter = new PortfolioRateLimiter();

/**
 * Token data from Alchemy Portfolio API
 */
export interface PortfolioTokenData {
  address: string;
  network: string;
  tokenAddress: string | null; // null for native tokens
  tokenBalance: string;
  tokenMetadata?: {
    decimals: number;
    logo?: string;
    name?: string;
    symbol?: string;
  };
  tokenPrices?: Array<{
    currency: string;
    value: string;
    lastUpdatedAt: string;
  }>;
  error?: string | null;
}

/**
 * NFT data from Alchemy Portfolio API
 */
export interface PortfolioNFTData {
  network: string;
  address: string;
  contract: {
    address: string;
    name?: string;
    symbol?: string;
    totalSupply?: string;
    tokenType: 'ERC721' | 'ERC1155' | 'NO_SUPPORTED_NFT_STANDARD' | 'NOT_A_CONTRACT';
    contractDeployer?: string;
    deployedBlockNumber?: number;
    openseaMetadata?: {
      floorPrice?: number;
      collectionName?: string;
      imageUrl?: string;
      description?: string;
      externalUrl?: string;
      twitterUsername?: string;
      discordUrl?: string;
      bannerImageUrl?: string;
    };
    isSpam?: string;
    spamClassifications?: string[];
  };
  tokenId: string;
  tokenType?: string;
  name?: string;
  description?: string;
  image?: {
    cachedUrl?: string;
    thumbnailUrl?: string;
    pngUrl?: string;
    contentType?: string;
    size?: number;
    originalUrl?: string;
  };
  raw?: {
    tokenUri?: string;
    metadata?: {
      image?: string;
      name?: string;
      description?: string;
      attributes?: Array<{
        trait_type?: string;
        value?: string;
      }>;
    };
    error?: string;
  };
  collection?: {
    name?: string;
    slug?: string;
    externalUrl?: string;
    bannerImageUrl?: string;
  };
  tokenUri?: string;
  timeLastUpdated?: string;
  acquiredAt?: {
    blockTimestamp?: string;
    blockNumber?: string;
  };
}

/**
 * Get tokens (ERC20, Native, SPL) for multiple addresses and networks using Alchemy Portfolio API
 * https://www.alchemy.com/docs/data/portfolio-apis/portfolio-api-endpoints/portfolio-api-endpoints/get-tokens-by-address
 * 
 * @param requests - Array of { address, chainIds[] } to fetch tokens for
 *                   Maximum 2 addresses, 5 networks per address
 * @param options - Optional parameters
 * @returns Map of address -> chainId -> tokens
 */
export async function getTokensByAddress(
  requests: Array<{ address: string; chainIds: number[] }>,
  options: {
    withMetadata?: boolean;
    withPrices?: boolean;
    includeNativeTokens?: boolean;
    includeErc20Tokens?: boolean;
  } = {}
): Promise<Map<string, Map<number, PortfolioTokenData[]>>> {
  const apiUrl = getAlchemyPortfolioApiUrl();
  if (!apiUrl) {
    return new Map();
  }

  // Portfolio API limits: max 2 addresses, 5 networks per address
  const limitedRequests = requests.slice(0, 2).map(req => ({
    address: ethers.getAddress(req.address.toLowerCase()),
    chainIds: req.chainIds.slice(0, 5),
  }));

  if (limitedRequests.length === 0) {
    return new Map();
  }

  // Wait for rate limit
  await portfolioRateLimiter.waitForRateLimit();

  // Retry up to 3 times with exponential backoff (for the first request only)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const allTokens: PortfolioTokenData[] = [];
      let pageKey: string | undefined;
      const maxPages = 20; // Safety limit to avoid infinite loops
      let pageCount = 0;

      // Paginate through all token pages (Alchemy returns pageKey when more results exist)
      // Note: each page is a separate API call; compute units are logged per request (~30/page)
      do {
        if (pageCount >= maxPages) break;
        pageCount += 1;
        computeUnitTracker.logApiCall(
          'alchemy_portfolio_tokens',
          'getTokensByAddress',
          { estimatedUnits: 30 }
        );

        const response = await fetch(`${apiUrl}/assets/tokens/by-address`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Encoding': 'gzip', // Alchemy best practice: Use gzip compression
          },
          body: JSON.stringify({
            addresses: limitedRequests.map(req => ({
              address: req.address,
              networks: req.chainIds
                .map(chainId => getAlchemyNetworkName(chainId))
                .filter((name): name is string => name !== null),
            })),
            withMetadata: options.withMetadata ?? true,
            withPrices: options.withPrices ?? true,
            includeNativeTokens: options.includeNativeTokens ?? true,
            includeErc20Tokens: options.includeErc20Tokens ?? true,
            ...(pageKey !== undefined && { pageKey }),
          }),
        });

        // Handle rate limit errors
        if (response.status === 429 || response.status === 503) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter 
            ? parseInt(retryAfter, 10) * 1000 
            : Math.pow(2, attempt) * 2000; // Exponential backoff: 2s, 4s, 8s
          
          if (attempt < 2) {
            console.warn(`[Portfolio API] Rate limited, retrying in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          return new Map();
        }

        if (!response.ok) {
          if (attempt === 2) {
            console.error(`[Portfolio API] Error: ${response.statusText}`);
          }
          return new Map();
        }

        const data = await response.json() as {
          data?: {
            tokens?: PortfolioTokenData[];
            pageKey?: string;
          };
          error?: {
            message?: string;
          };
        };

        if (data.error) {
          const errorMessage = (data.error.message || '').toLowerCase();
          if (errorMessage.includes('too many requests') || errorMessage.includes('rate limit')) {
            const waitTime = Math.pow(2, attempt) * 2000;
            if (attempt < 2) {
              console.warn(`[Portfolio API] Rate limited, retrying in ${waitTime}ms...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
          }
          if (attempt === 2) {
            console.error(`[Portfolio API] Error:`, data.error);
          }
          return new Map();
        }

        const pageTokens = data.data?.tokens || [];
        allTokens.push(...pageTokens);
        pageKey = data.data?.pageKey;

        if (pageKey) {
          await portfolioRateLimiter.waitForRateLimit();
        }
      } while (pageKey);

      // Organize results by address and network
      const resultMap = new Map<string, Map<number, PortfolioTokenData[]>>();

      for (const token of allTokens) {
        const addressLower = token.address.toLowerCase();
        const networkName = token.network;
        
        // Find chainId from network name
        const chainId = getChainIdFromNetworkName(networkName);
        if (!chainId) continue;

        if (!resultMap.has(addressLower)) {
          resultMap.set(addressLower, new Map());
        }

        const addressMap = resultMap.get(addressLower)!;
        if (!addressMap.has(chainId)) {
          addressMap.set(chainId, []);
        }

        addressMap.get(chainId)!.push(token);
      }

      return resultMap;
    } catch (error) {
      if (attempt === 2) {
        console.error(`[Portfolio API] Error fetching tokens:`, error);
      }
      if (attempt < 2) {
        const waitTime = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  return new Map();
}

/**
 * Get NFTs (ERC721, ERC1155) for multiple addresses and networks using Alchemy Portfolio API
 * https://www.alchemy.com/docs/data/portfolio-apis/portfolio-api-endpoints/portfolio-api-endpoints/get-nfts-by-address
 * 
 * @param requests - Array of { address, chainIds[] } to fetch NFTs for
 *                   Maximum 2 addresses, 15 networks per address
 * @param options - Optional parameters
 * @returns Map of address -> chainId -> NFTs
 */
export async function getNFTsByAddress(
  requests: Array<{ address: string; chainIds: number[] }>,
  options: {
    withMetadata?: boolean;
    pageKey?: string;
    pageSize?: number;
    orderBy?: 'transferTime';
    sortOrder?: 'asc' | 'desc';
    excludeFilters?: Array<'SPAM' | 'AIRDROPS'>;
    includeFilters?: Array<'SPAM' | 'AIRDROPS'>;
    spamConfidenceLevel?: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
  } = {}
): Promise<Map<string, Map<number, { nfts: PortfolioNFTData[]; totalCount?: number; pageKey?: string }>>> {
  const apiUrl = getAlchemyPortfolioApiUrl();
  if (!apiUrl) {
    return new Map();
  }

  // Portfolio API limits: max 2 addresses, 15 networks per address
  const limitedRequests = requests.slice(0, 2).map(req => ({
    address: ethers.getAddress(req.address.toLowerCase()),
    chainIds: req.chainIds.slice(0, 15),
  }));

  if (limitedRequests.length === 0) {
    return new Map();
  }

  // Wait for rate limit
  await portfolioRateLimiter.waitForRateLimit();

  // Retry up to 3 times with exponential backoff
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Track compute units before making the call
      computeUnitTracker.logApiCall(
        'alchemy_portfolio_nfts',
        'getNFTsByAddress',
        { estimatedUnits: 30 }
      );

      const response = await fetch(`${apiUrl}/assets/nfts/by-address`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip', // Alchemy best practice: Use gzip compression
        },
        body: JSON.stringify({
          addresses: limitedRequests.map(req => ({
            address: req.address,
            networks: req.chainIds
              .map(chainId => getAlchemyNetworkName(chainId))
              .filter((name): name is string => name !== null),
            excludeFilters: options.excludeFilters,
            includeFilters: options.includeFilters,
            spamConfidenceLevel: options.spamConfidenceLevel,
          })),
          withMetadata: options.withMetadata ?? true,
          pageKey: options.pageKey,
          pageSize: options.pageSize ? Math.min(options.pageSize, 50) : 50, // Alchemy best practice: Keep batches under 50
          orderBy: options.orderBy,
          sortOrder: options.sortOrder,
        }),
      });

      // Handle rate limit errors
      if (response.status === 429 || response.status === 503) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter 
          ? parseInt(retryAfter, 10) * 1000 
          : Math.pow(2, attempt) * 2000;
        
        if (attempt < 2) {
          console.warn(`[Portfolio API] Rate limited, retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        return new Map();
      }

      if (!response.ok) {
        if (attempt === 2) {
          console.error(`[Portfolio API] Error: ${response.statusText}`);
        }
        return new Map();
      }

      const data = await response.json() as {
        data?: {
          ownedNfts?: PortfolioNFTData[];
          totalCount?: number;
          pageKey?: string;
        };
        error?: {
          message?: string;
        };
      };

      if (data.error) {
        const errorMessage = (data.error.message || '').toLowerCase();
        if (errorMessage.includes('too many requests') || errorMessage.includes('rate limit')) {
          const waitTime = Math.pow(2, attempt) * 2000;
          if (attempt < 2) {
            console.warn(`[Portfolio API] Rate limited, retrying in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
        if (attempt === 2) {
          console.error(`[Portfolio API] Error:`, data.error);
        }
        return new Map();
      }

      // Organize results by address and network
      const resultMap = new Map<string, Map<number, { nfts: PortfolioNFTData[]; totalCount?: number; pageKey?: string }>>();
      const nfts = data.data?.ownedNfts || [];
      const totalCount = data.data?.totalCount;
      const pageKey = data.data?.pageKey;

      for (const nft of nfts) {
        const addressLower = nft.address.toLowerCase();
        const networkName = nft.network;
        
        // Find chainId from network name
        const chainId = getChainIdFromNetworkName(networkName);
        if (!chainId) continue;

        if (!resultMap.has(addressLower)) {
          resultMap.set(addressLower, new Map());
        }

        const addressMap = resultMap.get(addressLower)!;
        if (!addressMap.has(chainId)) {
          addressMap.set(chainId, { nfts: [], totalCount, pageKey });
        }

        addressMap.get(chainId)!.nfts.push(nft);
      }

      // Set totalCount and pageKey for all entries
      for (const addressMap of resultMap.values()) {
        for (const chainData of addressMap.values()) {
          if (totalCount !== undefined) chainData.totalCount = totalCount;
          if (pageKey) chainData.pageKey = pageKey;
        }
      }

      return resultMap;
    } catch (error) {
      if (attempt === 2) {
        console.error(`[Portfolio API] Error fetching NFTs:`, error);
      }
      if (attempt < 2) {
        const waitTime = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  return new Map();
}

/**
 * Helper function to get chainId from Alchemy network name
 */
function getChainIdFromNetworkName(networkName: string): number | null {
  const networkMap: Record<string, number> = {
    'eth-mainnet': 1,
    'opt-mainnet': 10,
    'base-mainnet': 8453,
    'polygon-mainnet': 137,
    'arb-mainnet': 42161,
    'gnosis-mainnet': 100,
    'eth-sepolia': 11155111,
    'base-sepolia': 84532,
    'polygon-mumbai': 80001,
  };

  return networkMap[networkName] || null;
}

/**
 * Convert Portfolio API token data to TokenBalanceData format
 */
export function convertPortfolioTokenToBalanceData(
  token: PortfolioTokenData,
  chainId: number
): {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceRaw: string;
  priceUSD?: number;
} | null {
  if (token.error || !token.tokenMetadata) {
    return null;
  }

  const metadata = token.tokenMetadata;
  const balanceRaw = BigInt(token.tokenBalance || '0');
  
  if (balanceRaw === 0n) {
    return null;
  }

  // Get USD price if available
  let priceUSD: number | undefined;
  if (token.tokenPrices && token.tokenPrices.length > 0) {
    const usdPrice = token.tokenPrices.find(p => p.currency === 'USD') || token.tokenPrices[0];
    if (usdPrice && usdPrice.value) {
      priceUSD = parseFloat(usdPrice.value);
    }
  }

  // Handle native tokens (tokenAddress is null)
  const address = token.tokenAddress || '0x0000000000000000000000000000000000000000';

  return {
    address: address.toLowerCase(),
    symbol: metadata.symbol || 'UNKNOWN',
    name: metadata.name || 'Unknown Token',
    decimals: metadata.decimals || 18,
    balance: ethers.formatUnits(balanceRaw, metadata.decimals || 18),
    balanceRaw: balanceRaw.toString(),
    priceUSD,
  };
}

/**
 * Convert Portfolio API NFT data to GeneralNFTData format
 */
export function convertPortfolioNFTToGeneralNFT(
  nft: PortfolioNFTData,
  chainId: number
): {
  tokenId: string;
  owner: string;
  contractAddress: string;
  uri: string;
  name?: string;
  symbol?: string;
  priceUSD?: number;
  standard: 'ERC721' | 'ERC1155';
  amount?: string;
  image?: string;
  description?: string;
  attributes?: Array<{ trait_type?: string; value?: string }>;
} | null {
  if (nft.contract.tokenType === 'NO_SUPPORTED_NFT_STANDARD' || 
      nft.contract.tokenType === 'NOT_A_CONTRACT') {
    return null;
  }

  const standard = nft.contract.tokenType === 'ERC1155' ? 'ERC1155' : 'ERC721';
  
  // Get price from OpenSea metadata if available
  let priceUSD: number | undefined;
  if (nft.contract.openseaMetadata?.floorPrice) {
    priceUSD = nft.contract.openseaMetadata.floorPrice;
  }

  // Get image URL (prefer cached, fallback to original)
  const imageUrl = nft.image?.cachedUrl || 
                   nft.image?.pngUrl || 
                   nft.image?.thumbnailUrl || 
                   nft.image?.originalUrl || 
                   nft.raw?.metadata?.image || 
                   '';

  return {
    tokenId: nft.tokenId,
    owner: nft.address.toLowerCase(),
    contractAddress: nft.contract.address.toLowerCase(),
    uri: nft.tokenUri || nft.raw?.tokenUri || '',
    name: nft.name || nft.raw?.metadata?.name,
    symbol: nft.contract.symbol,
    priceUSD,
    standard,
    amount: '1', // Portfolio API doesn't return quantity for ERC1155 in this format
    image: imageUrl,
    description: nft.description || nft.raw?.metadata?.description,
    attributes: nft.raw?.metadata?.attributes,
  };
}
