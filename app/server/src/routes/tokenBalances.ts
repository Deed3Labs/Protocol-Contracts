import { Router, Request, Response } from 'express';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { getTokenBalance, getTokenBalancesBatch, getAllTokenBalances, getAllTokenBalancesMultiChain } from '../services/balanceService.js';

const router = Router();
const cacheServicePromise = getRedisClient().then((client) => new CacheService(client));

/**
 * GET /api/token-balances/all/:chainId/:userAddress
 * Get ALL ERC20 token balances for an address using Alchemy API
 * This is more efficient than checking individual tokens
 */
router.get('/all/:chainId/:userAddress', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.params.chainId, 10);
    const userAddress = req.params.userAddress.toLowerCase();
    const cacheService = await cacheServicePromise;

    // Check cache first
    const cacheKey = `all_token_balances:${chainId}:${userAddress}`;
    const cached = await cacheService.get<{ data: any[]; timestamp: number }>(cacheKey);

    if (cached) {
      return res.json({
        tokens: cached.data,
        cached: true,
        timestamp: cached.timestamp,
      });
    }

    // Fetch all tokens from Alchemy API
    const tokens = await getAllTokenBalances(chainId, userAddress);

    if (tokens.length === 0) {
      // If Alchemy API is not available, return empty array
      // Client can fallback to COMMON_TOKENS approach
      return res.json({
        tokens: [],
        cached: false,
        timestamp: Date.now(),
        fallback: 'Use COMMON_TOKENS approach if Alchemy API unavailable',
      });
    }

    // Cache the result
    const cacheTTL = parseInt(process.env.CACHE_TTL_BALANCE || '10', 10);
    await cacheService.set(
      cacheKey,
      { data: tokens, timestamp: Date.now() },
      cacheTTL
    );

    res.json({
      tokens,
      cached: false,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('All token balances fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/token-balances/:chainId/:userAddress/:tokenAddress
 * Get ERC20 token balance with caching
 */
router.get('/:chainId/:userAddress/:tokenAddress', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.params.chainId, 10);
    const userAddress = req.params.userAddress.toLowerCase();
    const tokenAddress = req.params.tokenAddress.toLowerCase();
    const cacheService = await cacheServicePromise;

    // Check cache first
    const cacheKey = CacheKeys.tokenBalance(chainId, userAddress, tokenAddress);
    const cached = await cacheService.get<{ data: any; timestamp: number }>(cacheKey);

    if (cached) {
      return res.json({
        ...cached.data,
        cached: true,
        timestamp: cached.timestamp,
      });
    }

    // Fetch from blockchain
    const result = await getTokenBalance(chainId, tokenAddress, userAddress);

    if (!result) {
      return res.status(404).json({
        error: 'Token balance not available',
        message: 'Token balance is zero or could not be fetched',
      });
    }

    // Cache the result
    const cacheTTL = parseInt(process.env.CACHE_TTL_BALANCE || '10', 10);
    await cacheService.set(
      cacheKey,
      { data: result, timestamp: Date.now() },
      cacheTTL
    );

    res.json({
      ...result,
      cached: false,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Token balance fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});


/**
 * POST /api/token-balances/all/batch
 * Get ALL token balances for multiple chains in one request
 * Body: { requests: [{ chainId, userAddress }] }
 */
router.post('/all/batch', async (req: Request, res: Response) => {
  try {
    const { requests } = req.body as {
      requests: Array<{ chainId: number; userAddress: string }>;
    };

    if (!Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'requests must be a non-empty array',
      });
    }

    const cacheService = await cacheServicePromise;
    const results: Array<{
      chainId: number;
      userAddress: string;
      tokens: any[];
      cached: boolean;
      error?: string;
    }> = [];
    const uncached: Array<{ chainId: number; userAddress: string; index: number }> = [];

    // Check cache for all requests
    for (let i = 0; i < requests.length; i++) {
      const { chainId, userAddress } = requests[i];
      const cacheKey = `all_token_balances:${chainId}:${userAddress.toLowerCase()}`;
      const cached = await cacheService.get<{ data: any[]; timestamp: number }>(cacheKey);

      if (cached) {
        results[i] = {
          chainId,
          userAddress,
          tokens: cached.data,
          cached: true,
        };
      } else {
        uncached.push({ chainId, userAddress, index: i });
      }
    }

    // Fetch uncached balances
    // Alchemy best practice: Send requests concurrently (not sequentially)
    // The rate limiter in balanceService will handle delays appropriately
    // Alchemy is built to handle concurrent requests at scale
    if (uncached.length > 0) {
      await Promise.all(
        uncached.map(async ({ chainId, userAddress, index }) => {
          try {
            const tokens = await getAllTokenBalances(chainId, userAddress);
            
            // Cache the result
            const cacheKey = `all_token_balances:${chainId}:${userAddress.toLowerCase()}`;
            const cacheTTL = parseInt(process.env.CACHE_TTL_BALANCE || '10', 10);
            await cacheService.set(
              cacheKey,
              { data: tokens, timestamp: Date.now() },
              cacheTTL
            );

            results[index] = {
              chainId,
              userAddress,
              tokens,
              cached: false,
            };
          } catch (error) {
            results[index] = {
              chainId,
              userAddress,
              tokens: [],
              cached: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        })
      );
    }

    res.json({ results });
  } catch (error) {
    console.error('Batch all token balances fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/token-balances/portfolio
 * Get ALL token balances (ERC20, Native) for multiple addresses and chains using Alchemy Portfolio API
 * This is the most efficient way to fetch tokens across multiple chains in a single request
 * 
 * Body: { 
 *   requests: [{ address: string, chainIds: number[] }],
 *   withMetadata?: boolean,
 *   withPrices?: boolean,
 *   includeNativeTokens?: boolean,
 *   includeErc20Tokens?: boolean
 * }
 * 
 * Limits: Maximum 2 addresses, 5 networks per address
 */
router.post('/portfolio', async (req: Request, res: Response) => {
  try {
    const { 
      requests, 
      withMetadata, 
      withPrices, 
      includeNativeTokens, 
      includeErc20Tokens 
    } = req.body as {
      requests: Array<{ address: string; chainIds: number[] }>;
      withMetadata?: boolean;
      withPrices?: boolean;
      includeNativeTokens?: boolean;
      includeErc20Tokens?: boolean;
    };

    if (!Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'requests must be a non-empty array',
      });
    }

    // Validate limits: max 2 addresses, 5 networks per address
    if (requests.length > 2) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Maximum 2 addresses allowed per request',
      });
    }

    for (const req of requests) {
      if (req.chainIds.length > 5) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Maximum 5 networks per address allowed',
        });
      }
    }

    const cacheService = await cacheServicePromise;
    const results: Array<{
      address: string;
      chainId: number;
      tokens: any[];
      cached: boolean;
      error?: string;
    }> = [];

    // Check cache for all address/chain combinations
    const uncached: Array<{ address: string; chainIds: number[] }> = [];
    const cacheMap = new Map<string, any[]>();

    for (const { address, chainIds } of requests) {
      const addressLower = address.toLowerCase();
      const uncachedChainIds: number[] = [];

      for (const chainId of chainIds) {
        const cacheKey = `all_token_balances:${chainId}:${addressLower}`;
        const cached = await cacheService.get<{ data: any[]; timestamp: number }>(cacheKey);

        if (cached) {
          results.push({
            address: addressLower,
            chainId,
            tokens: cached.data,
            cached: true,
          });
          cacheMap.set(`${addressLower}:${chainId}`, cached.data);
        } else {
          uncachedChainIds.push(chainId);
        }
      }

      if (uncachedChainIds.length > 0) {
        uncached.push({ address: addressLower, chainIds: uncachedChainIds });
      }
    }

    // Fetch uncached tokens using Portfolio API
    if (uncached.length > 0) {
      // Import Portfolio API service directly to get native format
      const { getTokensByAddress } = await import('../services/portfolioService.js');
      
      const portfolioResults = await getTokensByAddress(uncached, {
        withMetadata: withMetadata ?? true,
        withPrices: withPrices ?? true,
        includeNativeTokens: includeNativeTokens ?? true,
        includeErc20Tokens: includeErc20Tokens ?? true,
      });

      // Process results and cache them - return Portfolio API format directly
      for (const { address, chainIds } of uncached) {
        const addressMap = portfolioResults.get(address);
        if (!addressMap) continue;

        for (const chainId of chainIds) {
          const tokens = addressMap.get(chainId) || [];
          if (tokens.length > 0) {
            // Cache the result (Portfolio API format)
            const cacheKey = `all_token_balances:${chainId}:${address}`;
            const cacheTTL = parseInt(process.env.CACHE_TTL_BALANCE || '10', 10);
            await cacheService.set(
              cacheKey,
              { data: tokens, timestamp: Date.now() },
              cacheTTL
            );

            results.push({
              address,
              chainId,
              tokens, // Portfolio API format - includes metadata, prices, etc.
              cached: false,
            });
          }
        }
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('Portfolio token balances fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
