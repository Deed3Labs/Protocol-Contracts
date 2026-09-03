import { Router, Request, Response } from 'express';
import { CacheKeys } from '../config/redis.js';
import { requireWalletArrayMatch, requireWalletMatch } from '../middleware/auth.js';
import { getCacheServiceSafe } from '../utils/cache.js';
import { transfersService } from '../services/transfersService.js';

const router = Router();

/**
 * GET /api/transactions/:chainId/:address
 * Get transactions for an address with caching
 */
router.get('/:chainId/:address', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.params.chainId, 10);
    const address = req.params.address.toLowerCase();
    if (!requireWalletMatch(req, res, address, 'address')) return;

    const limit = parseInt((req.query.limit as string) || '20', 10);
    const cacheService = await getCacheServiceSafe();

    // Check cache first
    const cacheKey = CacheKeys.transactions(chainId, address, limit);
    const cached = cacheService
      ? await cacheService.get<{ transactions: any[]; timestamp: number }>(cacheKey)
      : null;

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
    // OPTIMIZATION: Increased cache TTL to 10 minutes (600s) to align with refresh intervals
    // Transactions don't change frequently, so longer cache reduces Alchemy compute unit usage
    // Using Alchemy Transfers API for fast, comprehensive transaction fetching
    const cacheTTL = parseInt(process.env.CACHE_TTL_TRANSACTION || '600', 10);
    if (cacheService) {
      await cacheService.set(
        cacheKey,
        { transactions, timestamp: Date.now() },
        cacheTTL
      );
    }

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

    if (!requireWalletArrayMatch(req, res, requests.map((r) => r.address), 'requests[].address')) return;

    const cacheService = await getCacheServiceSafe();
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
      const cached = cacheService
        ? await cacheService.get<{ transactions: any[]; timestamp: number }>(cacheKey)
        : null;

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

    // Fetch uncached transactions sequentially to respect Alchemy rate limits
    // Alchemy Transfers API doesn't support true batching, so we process one at a time
    // with a small delay between requests to avoid rate limiting
    for (const { chainId, address, limit, index } of uncached) {
      try {
        const transactions = await transfersService.getTransactions(chainId, address, limit);

        const cacheKey = CacheKeys.transactions(chainId, address.toLowerCase(), limit);
        // OPTIMIZATION: Increased cache TTL to 10 minutes (600s) to align with refresh intervals
        const cacheTTL = parseInt(process.env.CACHE_TTL_TRANSACTION || '600', 10);
        if (cacheService) {
          await cacheService.set(
            cacheKey,
            { transactions, timestamp: Date.now() },
            cacheTTL
          );
        }

        results[index] = {
          chainId,
          address,
          transactions,
          cached: false,
        };

        // Small delay between requests to avoid rate limiting (100ms = ~10 req/sec)
        if (index < uncached.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        results[index] = {
          chainId,
          address,
          transactions: [],
          cached: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
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
