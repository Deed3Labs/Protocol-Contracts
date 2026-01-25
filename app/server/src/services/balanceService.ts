import { ethers } from 'ethers';
import { getRpcUrl, getAlchemyRestUrl } from '../utils/rpc.js';
import { withRetry, createRetryProvider } from '../utils/rpcRetry.js';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { 
  getTokensByAddress, 
  convertPortfolioTokenToBalanceData 
} from './portfolioService.js';

/**
 * Rate limiter for Alchemy API calls
 * Light rate limiting to prevent accidental spikes, but allows concurrent requests
 * Alchemy best practice: Send requests concurrently - Alchemy is built to handle high concurrency
 * This limiter is a safety net, not a strict throttle
 */
class AlchemyRateLimiter {
  private lastRequestTime: Map<number, number> = new Map();
  private lastGlobalRequestTime: number = 0;
  private readonly minDelayMs = 50; // 50ms between requests per chain = ~20 req/sec per chain (light throttling)
  private readonly minGlobalDelayMs = 20; // 20ms between ANY requests globally = ~50 req/sec global (very light throttling)

  async waitForRateLimit(chainId: number): Promise<void> {
    const now = Date.now();
    
    // First, enforce global rate limit (across all chains)
    const timeSinceLastGlobalRequest = now - this.lastGlobalRequestTime;
    if (timeSinceLastGlobalRequest < this.minGlobalDelayMs) {
      const globalWaitTime = this.minGlobalDelayMs - timeSinceLastGlobalRequest;
      await new Promise(resolve => setTimeout(resolve, globalWaitTime));
    }
    
    // Then, enforce per-chain rate limit
    const lastRequest = this.lastRequestTime.get(chainId) || 0;
    const timeSinceLastRequest = Date.now() - lastRequest;

    if (timeSinceLastRequest < this.minDelayMs) {
      const waitTime = this.minDelayMs - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Update both timestamps
    this.lastRequestTime.set(chainId, Date.now());
    this.lastGlobalRequestTime = Date.now();
  }
}

const alchemyRateLimiter = new AlchemyRateLimiter();

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
];

export interface TokenBalanceData {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceRaw: string;
}

/**
 * Get native token balance for an address on a chain
 */
export async function getBalance(
  chainId: number,
  address: string
): Promise<{ balance: string; balanceWei: string; balanceUSD: number } | null> {
  try {
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      return null;
    }

    // Use retry provider to handle rate limits and network issues
    const provider = createRetryProvider(rpcUrl, chainId);
    const balanceWei = await withRetry(() => provider.getBalance(address));
    const balance = parseFloat(ethers.formatEther(balanceWei)).toFixed(4);

    // Note: balanceUSD calculation should be done on the client side with current price
    // We return 0 here and let the client calculate it
    return {
      balance,
      balanceWei: balanceWei.toString(),
      balanceUSD: 0, // Client will calculate with current price
    };
  } catch (error) {
    console.error(`Error fetching balance for ${address} on chain ${chainId}:`, error);
    return null;
  }
}

/**
 * Get ERC20 token balance for an address
 */
export async function getTokenBalance(
  chainId: number,
  tokenAddress: string,
  userAddress: string
): Promise<TokenBalanceData | null> {
  try {
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      return null;
    }

    // Use retry provider to handle rate limits and network issues
    const provider = createRetryProvider(rpcUrl, chainId);
    
    // Normalize addresses to lowercase to avoid checksum errors
    const normalizedTokenAddress = ethers.getAddress(tokenAddress.toLowerCase());
    const normalizedUserAddress = ethers.getAddress(userAddress.toLowerCase());
    
    // Check if contract has code (exists and is a contract)
    try {
      const code = await withRetry(() => provider.getCode(normalizedTokenAddress));
      if (!code || code === '0x') {
        // Contract doesn't exist at this address
        return null;
      }
    } catch (error) {
      // If we can't check code, continue anyway
    }
    
    const contract = new ethers.Contract(normalizedTokenAddress, ERC20_ABI, provider);

    // First, try to get decimals to verify it's an ERC20 token
    // If this fails, the contract likely isn't an ERC20 token
    let decimals: bigint;
    try {
      decimals = await withRetry(() => contract.decimals());
    } catch (error: any) {
      // If decimals() fails, check if it's a BAD_DATA error (contract doesn't have the function)
      if (error?.code === 'BAD_DATA' || error?.shortMessage?.includes('could not decode')) {
        // Contract exists but doesn't have ERC20 functions
        return null;
      }
      // For other errors, default to 18
      decimals = 18n;
    }

    // Now try to get balance - handle BAD_DATA errors specifically
    let balance: bigint;
    try {
      balance = await withRetry(() => contract.balanceOf(normalizedUserAddress));
    } catch (error: any) {
      // If balanceOf returns 0x (BAD_DATA), the contract doesn't have this function
      if (error?.code === 'BAD_DATA' || error?.shortMessage?.includes('could not decode')) {
        // Contract exists but doesn't have balanceOf function (not ERC20)
        return null;
      }
      // Re-throw other errors
      throw error;
    }

    if (balance === 0n) {
      return null; // Zero balance
    }

    // Get symbol and name with error handling
    let symbol: string;
    let name: string;
    try {
      [symbol, name] = await Promise.all([
        withRetry(() => contract.symbol()).catch(() => 'UNKNOWN'),
        withRetry(() => contract.name()).catch(() => 'Unknown Token'),
      ]);
    } catch (error) {
      symbol = 'UNKNOWN';
      name = 'Unknown Token';
    }

    return {
      address: normalizedTokenAddress.toLowerCase(),
      symbol,
      name,
      decimals: Number(decimals),
      balance: ethers.formatUnits(balance, decimals),
      balanceRaw: balance.toString(),
    };
  } catch (error) {
    // Only log non-BAD_DATA errors to avoid spam
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'BAD_DATA') {
      console.error(`Error fetching token balance for ${tokenAddress} on chain ${chainId}:`, error);
    }
    return null;
  }
}

/**
 * Get multiple native balances in batch
 */
export async function getBalancesBatch(
  requests: Array<{ chainId: number; address: string }>
): Promise<Array<{ chainId: number; address: string; balance: string | null; balanceWei: string | null; error?: string }>> {
  const results = await Promise.allSettled(
    requests.map(async ({ chainId, address }) => {
      const result = await getBalance(chainId, address);
      return {
        chainId,
        address,
        balance: result?.balance || null,
        balanceWei: result?.balanceWei || null,
      };
    })
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        chainId: requests[index].chainId,
        address: requests[index].address,
        balance: null,
        balanceWei: null,
        error: result.reason?.message || 'Unknown error',
      };
    }
  });
}

/**
 * Get multiple token balances in batch
 */
export async function getTokenBalancesBatch(
  requests: Array<{ chainId: number; tokenAddress: string; userAddress: string }>
): Promise<Array<{ chainId: number; tokenAddress: string; userAddress: string; data: TokenBalanceData | null; error?: string }>> {
  const results = await Promise.allSettled(
    requests.map(async ({ chainId, tokenAddress, userAddress }) => {
      const data = await getTokenBalance(chainId, tokenAddress, userAddress);
      return {
        chainId,
        tokenAddress,
        userAddress,
        data,
      };
    })
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        chainId: requests[index].chainId,
        tokenAddress: requests[index].tokenAddress,
        userAddress: requests[index].userAddress,
        data: null,
        error: result.reason?.message || 'Unknown error',
      };
    }
  });
}

/**
 * Get token metadata using Alchemy's API or cache
 */
async function getTokenMetadata(
  chainId: number, 
  tokenAddress: string, 
  cacheService: CacheService,
  alchemyRestUrl: string
): Promise<{ symbol: string; name: string; decimals: number } | null> {
  const cacheKey = CacheKeys.tokenMetadata(chainId, tokenAddress);
  
  // Try cache first (metadata is cached for 30 days as it rarely changes)
  const cached = await cacheService.get<{ symbol: string; name: string; decimals: number }>(cacheKey);
  if (cached) {
    return cached;
  }

  // Rate limit: wait before making request
  await alchemyRateLimiter.waitForRateLimit(chainId);

  // Retry up to 3 times with exponential backoff for rate limit errors
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Use Alchemy's optimized metadata API
      // Alchemy best practice: Use gzip compression for better performance
      const response = await fetch(alchemyRestUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip', // Enable gzip compression (75% latency improvement)
        },
        body: JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'alchemy_getTokenMetadata',
          params: [tokenAddress],
        }),
      });

      // Handle rate limit errors
      if (response.status === 429 || response.status === 503) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter 
          ? parseInt(retryAfter, 10) * 1000 
          : Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
        
        if (attempt < 2) {
          console.warn(`[Alchemy] Rate limited for chain ${chainId}, retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        return null;
      }

      if (!response.ok) return null;

      const data = await response.json() as { 
        error?: { code?: number; message?: string };
        result?: { symbol: string; name: string; decimals: number };
      };

      // Check for rate limit in error response
      if (data.error) {
        const errorMessage = (data.error.message || '').toLowerCase();
        if (errorMessage.includes('too many requests') || errorMessage.includes('rate limit')) {
          const waitTime = Math.pow(2, attempt) * 1000;
          if (attempt < 2) {
            console.warn(`[Alchemy] Rate limited for chain ${chainId}, retrying in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          return null;
        }
        return null;
      }

      if (data.result) {
        const metadata = {
          symbol: data.result.symbol || 'UNKNOWN',
          name: data.result.name || 'Unknown Token',
          decimals: data.result.decimals || 18,
        };
        
        // Cache for 30 days (2592000 seconds)
        await cacheService.set(cacheKey, metadata, 2592000);
        return metadata;
      }
    } catch (error) {
      if (attempt === 2) {
        console.error(`Error fetching metadata for ${tokenAddress} on chain ${chainId}:`, error);
      }
    }
  }

  return null;
}

/**
 * Get ALL ERC20 token balances for an address using Alchemy's API
 * This is much more efficient than checking individual tokens
 * 
 * @param chainId - The chain ID
 * @param userAddress - The user's wallet address
 * @returns Array of token balances, or empty array if Alchemy API is not available
 */
export async function getAllTokenBalances(
  chainId: number,
  userAddress: string
): Promise<TokenBalanceData[]> {
  try {
    const alchemyRestUrl = getAlchemyRestUrl(chainId);
    if (!alchemyRestUrl) {
      return [];
    }

    // Normalize address
    const normalizedAddress = ethers.getAddress(userAddress.toLowerCase());

    // Rate limit: wait before making request
    await alchemyRateLimiter.waitForRateLimit(chainId);

    // Retry up to 3 times with exponential backoff for rate limit errors
    let tokenBalances: Array<{ contractAddress: string; tokenBalance: string; error?: any }> = [];
    
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Call Alchemy's getTokenBalances API with "erc20" to get ALL tokens
        // Alchemy best practice: Use gzip compression for better performance
        const response = await fetch(alchemyRestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Encoding': 'gzip', // Enable gzip compression (75% latency improvement)
          },
          body: JSON.stringify({
            id: 1,
            jsonrpc: '2.0',
            method: 'alchemy_getTokenBalances',
            params: [normalizedAddress, 'erc20'],
          }),
        });

        // Handle rate limit errors
        if (response.status === 429 || response.status === 503) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter 
            ? parseInt(retryAfter, 10) * 1000 
            : Math.pow(2, attempt) * 2000; // Exponential backoff: 2s, 4s, 8s
          
          if (attempt < 2) {
            console.warn(`[Alchemy] Rate limited for chain ${chainId} (getTokenBalances), retrying in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          return [];
        }

        if (!response.ok) {
          // Only log non-rate-limit errors on final attempt
          if (attempt === 2 && response.status !== 429 && response.status !== 503) {
            console.error(`Alchemy API error for chain ${chainId}: ${response.statusText}`);
          }
          return [];
        }

        const data = await response.json() as {
          error?: { code?: number; message?: string };
          result?: {
            tokenBalances?: Array<{
              contractAddress: string;
              tokenBalance: string;
              error?: any;
            }>;
          };
        };
        
        // Check for rate limit in error response
        if (data.error) {
          const errorMessage = (data.error.message || '').toLowerCase();
          if (errorMessage.includes('too many requests') || errorMessage.includes('rate limit')) {
            const waitTime = Math.pow(2, attempt) * 2000;
            if (attempt < 2) {
              console.warn(`[Alchemy] Rate limited for chain ${chainId} (getTokenBalances), retrying in ${waitTime}ms...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
            return [];
          }
          // Only log non-rate-limit errors on final attempt
          if (attempt === 2) {
            const errorMessage = (data.error.message || '').toLowerCase();
            if (!errorMessage.includes('too many requests') && !errorMessage.includes('rate limit')) {
              console.error(`Alchemy API error for chain ${chainId}:`, data.error);
            }
          }
          return [];
        }

        tokenBalances = data.result?.tokenBalances || [];
        break; // Success, exit retry loop
      } catch (error) {
        if (attempt === 2) {
          console.error(`Error fetching token balances for chain ${chainId}:`, error);
        }
        if (attempt < 2) {
          const waitTime = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    if (tokenBalances.length === 0) {
      return [];
    }

    const cacheService = await getRedisClient().then(client => new CacheService(client));
    const results: TokenBalanceData[] = [];

    // Process tokens in smaller batches with delays to avoid rate limits
    // Reduced batch size to be more conservative with rate limits
    const batchSize = 5; 
    
    for (let i = 0; i < tokenBalances.length; i += batchSize) {
      // Add delay between batches to avoid rate limits
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay between batches
      }
      
      const batch = tokenBalances.slice(i, i + batchSize);
      
      // Process batch sequentially to respect rate limits
      for (const tokenBalance of batch) {
        try {
          const balanceHex = tokenBalance.tokenBalance;
          if (!balanceHex || balanceHex === '0x' || tokenBalance.error) {
            continue;
          }

          const balanceRaw = BigInt(balanceHex);
          if (balanceRaw === 0n) continue;

          const metadata = await getTokenMetadata(
            chainId, 
            tokenBalance.contractAddress, 
            cacheService, 
            alchemyRestUrl
          );

          if (!metadata) continue;

          results.push({
            address: tokenBalance.contractAddress.toLowerCase(),
            symbol: metadata.symbol,
            name: metadata.name,
            decimals: metadata.decimals,
            balance: ethers.formatUnits(balanceRaw, metadata.decimals),
            balanceRaw: balanceRaw.toString(),
          });
        } catch (error) {
          // Continue processing other tokens
          continue;
        }
      }
      
      // Limit total tokens processed to prevent massive responses and timeouts
      if (results.length >= 50) break;
    }

    return results;
  } catch (error) {
    console.error(`Error fetching all token balances for chain ${chainId}:`, error);
    return [];
  }
}

/**
 * Get ALL token balances (ERC20, Native) for multiple addresses and chains using Alchemy Portfolio API
 * This is the most efficient way to fetch tokens across multiple chains in a single request
 * 
 * @param requests - Array of { address, chainIds[] } to fetch tokens for
 * @param options - Optional parameters
 * @returns Map of address -> chainId -> tokens
 */
export async function getAllTokenBalancesMultiChain(
  requests: Array<{ address: string; chainIds: number[] }>,
  options: {
    withMetadata?: boolean;
    withPrices?: boolean;
    includeNativeTokens?: boolean;
    includeErc20Tokens?: boolean;
  } = {}
): Promise<Map<string, Map<number, TokenBalanceData[]>>> {
  try {
    // Use Portfolio API for multi-chain fetching
    const portfolioResults = await getTokensByAddress(requests, options);
    
    // Convert Portfolio API format to TokenBalanceData format
    const resultMap: Map<string, Map<number, TokenBalanceData[]>> = new Map();
    
    for (const [address, chainMap] of portfolioResults.entries()) {
      const addressResultMap: Map<number, TokenBalanceData[]> = new Map();
      
      for (const [chainId, tokens] of chainMap.entries()) {
        const convertedTokens: TokenBalanceData[] = [];
        
        for (const token of tokens) {
          const converted = convertPortfolioTokenToBalanceData(token, chainId);
          if (converted) {
            convertedTokens.push({
              address: converted.address,
              symbol: converted.symbol,
              name: converted.name,
              decimals: converted.decimals,
              balance: converted.balance,
              balanceRaw: converted.balanceRaw,
            });
          }
        }
        
        if (convertedTokens.length > 0) {
          addressResultMap.set(chainId, convertedTokens);
        }
      }
      
      if (addressResultMap.size > 0) {
        resultMap.set(address, addressResultMap);
      }
    }
    
    return resultMap;
  } catch (error) {
    console.error(`Error fetching multi-chain token balances:`, error);
    return new Map();
  }
}

