import { Router, Request, Response } from 'express';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { transfersService } from '../services/transfersService.js';

const router = Router();
const cacheServicePromise = getRedisClient().then((client) => new CacheService(client));

/**
 * GET /api/transactions/:chainId/:address
 * Get transactions for an address with caching
 */
router.get('/:chainId/:address', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.params.chainId, 10);
    const address = req.params.address.toLowerCase();
    const limit = parseInt((req.query.limit as string) || '20', 10);
    const cacheService = await cacheServicePromise;

    // Check cache first
    const cacheKey = CacheKeys.transactions(chainId, address, limit);
    const cached = await cacheService.get<{ transactions: any[]; timestamp: number }>(cacheKey);

    if (cached) {
      return res.json({
        transactions: cached.transactions,
        cached: true,
        timestamp: cached.timestamp,
      });
    }

    // Fetch from Alchemy Transfers API
    const transactions = await transfersService.getTransactions(chainId, address, limit);

    // Cache the result
    // Aligned with refresh interval: 5 minutes (300s) - transactions update more frequently
    // Using Alchemy Transfers API for fast, comprehensive transaction fetching
    const cacheTTL = parseInt(process.env.CACHE_TTL_TRANSACTION || '300', 10);
    await cacheService.set(
      cacheKey,
      { transactions, timestamp: Date.now() },
      cacheTTL
    );

    res.json({
      transactions,
      cached: false,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Transaction fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/transactions/batch
 * Get transactions for multiple addresses/chains in one request
 * Body: { requests: [{ chainId, address, limit? }] }
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { requests } = req.body as {
      requests: Array<{ chainId: number; address: string; limit?: number }>;
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
      address: string;
      transactions: any[];
      cached: boolean;
      error?: string;
    }> = [];
    const uncached: Array<{ chainId: number; address: string; limit: number; index: number }> = [];

    // Check cache for all requests
    for (let i = 0; i < requests.length; i++) {
      const { chainId, address, limit = 20 } = requests[i];
      const cacheKey = CacheKeys.transactions(chainId, address.toLowerCase(), limit);
      const cached = await cacheService.get<{ transactions: any[]; timestamp: number }>(cacheKey);

      if (cached) {
        results[i] = {
          chainId,
          address,
          transactions: cached.transactions,
          cached: true,
        };
      } else {
        uncached.push({ chainId, address, limit, index: i });
      }
    }

    // Fetch uncached transactions in parallel (much faster than sequential)
    // Using Alchemy Transfers API which is optimized for batch requests
    const fetchPromises = uncached.map(async ({ chainId, address, limit, index }) => {
      try {
        const transactions = await transfersService.getTransactions(chainId, address, limit);

        const cacheKey = CacheKeys.transactions(chainId, address.toLowerCase(), limit);
        const cacheTTL = parseInt(process.env.CACHE_TTL_TRANSACTION || '300', 10);
        await cacheService.set(
          cacheKey,
          { transactions, timestamp: Date.now() },
          cacheTTL
        );

        return {
          index,
          chainId,
          address,
          transactions,
          cached: false,
        };
      } catch (error) {
        return {
          index,
          chainId,
          address,
          transactions: [],
          cached: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    const fetchResults = await Promise.all(fetchPromises);
    for (const result of fetchResults) {
      results[result.index] = {
        chainId: result.chainId,
        address: result.address,
        transactions: result.transactions,
        cached: result.cached,
        error: result.error,
      };
    }

    res.json({ results });
  } catch (error) {
    console.error('Batch transaction fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
