import { ethers } from 'ethers';
import { getRpcUrlForNetwork } from '@/config/networks';

/**
 * RPC Request Optimizer
 * 
 * Features:
 * 1. Provider pooling - reuse providers instead of creating new ones
 * 2. Request batching - combine multiple RPC calls into single batch requests
 * 3. Request caching - cache results to avoid duplicate requests
 * 4. Rate limiting - throttle requests to prevent 429 errors
 * 5. Smart retry - exponential backoff for rate limit errors
 */

// Provider pool - cache providers by chain ID
const providerPool = new Map<number, ethers.JsonRpcProvider>();

// Request cache - cache results with TTL
interface CachedRequest {
  result: any;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

const requestCache = new Map<string, CachedRequest>();

// Rate limiter - track requests per chain
interface RateLimitState {
  requests: number[];
  windowStart: number;
}

const rateLimiters = new Map<number, RateLimitState>();
// Global rate limiter - tracks requests across all chains to prevent overwhelming RPC providers
let globalRateLimiter: RateLimitState = { requests: [], windowStart: Date.now() };

// Configuration
const RATE_LIMIT_WINDOW = 1000; // 1 second window
const MAX_REQUESTS_PER_WINDOW = 3; // Reduced to 3 requests per second per chain to avoid rate limits
const GLOBAL_MAX_REQUESTS_PER_WINDOW = 10; // Global limit across all chains (prevents overwhelming RPC providers)
const CACHE_TTL = 30000; // Increased cache to 30 seconds to reduce API calls (balances freshness vs rate limits)

/**
 * Get or create a cached provider for a chain
 */
export function getCachedProvider(chainId: number): ethers.JsonRpcProvider {
  if (providerPool.has(chainId)) {
    return providerPool.get(chainId)!;
  }

  const rpcUrl = getRpcUrlForNetwork(chainId);
  if (!rpcUrl) {
    throw new Error(`No RPC URL available for chain ${chainId}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  providerPool.set(chainId, provider);
  return provider;
}

/**
 * Check if we should throttle requests for a chain
 * Implements both per-chain and global rate limiting
 */
function shouldThrottle(chainId: number): boolean {
  const now = Date.now();
  
  // Check global rate limit first (prevents overwhelming RPC providers across all chains)
  globalRateLimiter.requests = globalRateLimiter.requests.filter(
    timestamp => now - timestamp < RATE_LIMIT_WINDOW
  );
  if (globalRateLimiter.requests.length >= GLOBAL_MAX_REQUESTS_PER_WINDOW) {
    return true; // Global limit reached
  }
  
  // Check per-chain rate limit
  const limiter = rateLimiters.get(chainId) || { requests: [], windowStart: now };
  
  // Remove old requests outside the window
  limiter.requests = limiter.requests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  
  // Check if we're at the per-chain limit
  if (limiter.requests.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  // Record this request for both global and per-chain limiters
  limiter.requests.push(now);
  rateLimiters.set(chainId, limiter);
  globalRateLimiter.requests.push(now);
  
  return false;
}

/**
 * Get cache key for a request
 */
function getCacheKey(method: string, params: any[]): string {
  return `${method}:${JSON.stringify(params)}`;
}

/**
 * Check cache for a request
 */
function getCachedRequest(method: string, params: any[]): any | null {
  const key = getCacheKey(method, params);
  const cached = requestCache.get(key);
  
  if (!cached) return null;
  
  // Check if cache is still valid
  if (Date.now() - cached.timestamp > cached.ttl) {
    requestCache.delete(key);
    return null;
  }
  
  return cached.result;
}

/**
 * Cache a request result
 */
function cacheRequest(method: string, params: any[], result: any, ttl: number = CACHE_TTL): void {
  const key = getCacheKey(method, params);
  requestCache.set(key, {
    result,
    timestamp: Date.now(),
    ttl
  });
}

/**
 * Execute a single RPC call with caching and rate limiting
 */
export async function executeRpcCall(
  chainId: number,
  method: string,
  params: any[],
  options: { useCache?: boolean; cacheTTL?: number } = {}
): Promise<any> {
  const { useCache = true, cacheTTL = CACHE_TTL } = options;
  
  // Check cache first
  if (useCache) {
    const cached = getCachedRequest(method, params);
    if (cached !== null) {
      return cached;
    }
  }
  
  // Rate limiting - wait if needed
  while (shouldThrottle(chainId)) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const provider = getCachedProvider(chainId);
  
  // Retry logic with exponential backoff for 429 errors
  let lastError: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await provider.send(method, params);
      
      // Cache the result
      if (useCache) {
        cacheRequest(method, params, result, cacheTTL);
      }
      
      return result;
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a rate limit error (429)
      const isRateLimit = error?.code === 429 || 
                         error?.statusCode === 429 ||
                         error?.message?.includes('429') ||
                         error?.message?.includes('rate limit') ||
                         error?.message?.includes('too many requests');
      
      if (isRateLimit && attempt < 2) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // For non-rate-limit errors or final attempt, throw
      throw error;
    }
  }
  
  throw lastError;
}

/**
 * Batch multiple RPC calls into a single request
 * This is much more efficient than individual calls
 */
export async function executeBatchRpcCalls(
  chainId: number,
  calls: Array<{ method: string; params: any[]; id?: number }>,
  options: { useCache?: boolean } = {}
): Promise<any[]> {
  const { useCache = true } = options;
  
  // Check cache for all calls first
  const cachedResults: Array<{ index: number; result: any }> = [];
  const uncachedCalls: Array<{ index: number; method: string; params: any[]; id: number }> = [];
  
  calls.forEach((call, index) => {
    if (useCache) {
      const cached = getCachedRequest(call.method, call.params);
      if (cached !== null) {
        cachedResults.push({ index, result: cached });
        return;
      }
    }
    uncachedCalls.push({
      index,
      method: call.method,
      params: call.params,
      id: call.id || index
    });
  });
  
  // If all were cached, return cached results
  if (uncachedCalls.length === 0) {
    const results = new Array(calls.length);
    cachedResults.forEach(({ index, result }) => {
      results[index] = result;
    });
    return results;
  }
  
  // Rate limiting
  while (shouldThrottle(chainId)) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Create batch request payload
  const batchRequests = uncachedCalls.map(call => ({
    jsonrpc: '2.0',
    id: call.id,
    method: call.method,
    params: call.params
  }));
  
  // Retry logic with exponential backoff
  let lastError: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Use fetch directly for batch requests (ethers doesn't support batch natively)
      const rpcUrl = getRpcUrlForNetwork(chainId);
      if (!rpcUrl) {
        throw new Error(`No RPC URL available for chain ${chainId}`);
      }
      
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batchRequests)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const results = await response.json();
      const resultArray = Array.isArray(results) ? results : [results];
      
      // Cache results and build final result array
      const finalResults = new Array(calls.length);
      
      // Fill in cached results
      cachedResults.forEach(({ index, result }) => {
        finalResults[index] = result;
      });
      
      // Fill in batch results
      uncachedCalls.forEach((call) => {
        const batchResult = resultArray.find((r: any) => r.id === call.id);
        if (batchResult && !batchResult.error) {
          finalResults[call.index] = batchResult.result;
          
          // Cache the result
          if (useCache) {
            cacheRequest(call.method, call.params, batchResult.result);
          }
        } else {
          // Handle error in batch response - use null/undefined for failed calls
          finalResults[call.index] = null;
        }
      });
      
      return finalResults;
    } catch (error: any) {
      lastError = error;
      
      const isRateLimit = error?.code === 429 || 
                         error?.statusCode === 429 ||
                         error?.message?.includes('429') ||
                         error?.message?.includes('rate limit') ||
                         error?.message?.includes('too many requests');
      
      if (isRateLimit && attempt < 2) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
}

/**
 * Get balance using optimized RPC call
 */
export async function getBalanceOptimized(
  chainId: number,
  address: string,
  useCache = true
): Promise<bigint> {
  const result = await executeRpcCall(
    chainId,
    'eth_getBalance',
    [address, 'latest'],
    { useCache, cacheTTL: 10000 } // Cache balance for 10 seconds
  );
  
  return BigInt(result);
}

/**
 * Batch get multiple token balances
 */
export async function batchGetTokenBalances(
  chainId: number,
  address: string,
  tokenAddresses: string[]
): Promise<Array<{ address: string; balance: bigint }>> {
  const calls = tokenAddresses.map((tokenAddress, index) => ({
    method: 'eth_call',
    params: [{
      to: tokenAddress,
      data: `0x70a08231${address.slice(2).padStart(64, '0')}` // balanceOf(address) selector + padded address
    }, 'latest'],
    id: index
  }));
  
  const results = await executeBatchRpcCalls(chainId, calls, { useCache: true });
  
  return tokenAddresses.map((address, index) => ({
    address,
    balance: BigInt(results[index] || '0x0')
  }));
}

/**
 * Clear cache for a specific chain or all chains
 */
export function clearCache(chainId?: number): void {
  if (chainId) {
    // Clear cache entries for specific chain (would need to track chain in cache key)
    // For now, clear all cache
    requestCache.clear();
  } else {
    requestCache.clear();
  }
}

/**
 * Clear rate limiters
 */
export function clearRateLimiters(): void {
  rateLimiters.clear();
}
