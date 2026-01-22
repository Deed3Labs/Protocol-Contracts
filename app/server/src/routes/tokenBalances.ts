import { Router, Request, Response } from 'express';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { getTokenBalance, getTokenBalancesBatch } from '../services/tokenBalanceService.js';

const router = Router();
const cacheServicePromise = getRedisClient().then((client) => new CacheService(client));

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
 * POST /api/token-balances/batch
 * Get multiple token balances in one request
 * Body: { requests: [{ chainId, tokenAddress, userAddress }] }
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { requests } = req.body as {
      requests: Array<{ chainId: number; tokenAddress: string; userAddress: string }>;
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
      tokenAddress: string;
      userAddress: string;
      data: any | null;
      cached: boolean;
      error?: string;
    }> = [];
    const uncached: Array<{ chainId: number; tokenAddress: string; userAddress: string; index: number }> = [];

    // Check cache for all requests
    for (let i = 0; i < requests.length; i++) {
      const { chainId, tokenAddress, userAddress } = requests[i];
      const cacheKey = CacheKeys.tokenBalance(chainId, userAddress.toLowerCase(), tokenAddress.toLowerCase());
      const cached = await cacheService.get<{ data: any; timestamp: number }>(cacheKey);

      if (cached) {
        results[i] = {
          chainId,
          tokenAddress,
          userAddress,
          data: cached.data,
          cached: true,
        };
      } else {
        uncached.push({ chainId, tokenAddress, userAddress, index: i });
      }
    }

    // Fetch uncached balances
    if (uncached.length > 0) {
      const batchResults = await getTokenBalancesBatch(
        uncached.map(({ chainId, tokenAddress, userAddress }) => ({ chainId, tokenAddress, userAddress }))
      );

      for (let i = 0; i < uncached.length; i++) {
        const { chainId, tokenAddress, userAddress, index } = uncached[i];
        const result = batchResults[i];

        if (result.data) {
          const cacheKey = CacheKeys.tokenBalance(chainId, userAddress.toLowerCase(), tokenAddress.toLowerCase());
          const cacheTTL = parseInt(process.env.CACHE_TTL_BALANCE || '10', 10);
          await cacheService.set(
            cacheKey,
            { data: result.data, timestamp: Date.now() },
            cacheTTL
          );

          results[index] = {
            chainId,
            tokenAddress,
            userAddress,
            data: result.data,
            cached: false,
          };
        } else {
          results[index] = {
            chainId,
            tokenAddress,
            userAddress,
            data: null,
            cached: false,
            error: result.error || 'Failed to fetch token balance',
          };
        }
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('Batch token balance fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
