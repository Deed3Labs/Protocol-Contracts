import { Router, Request, Response } from 'express';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { getBalance, getBalancesBatch } from '../services/balanceService.js';

const router = Router();
const cacheServicePromise = getRedisClient().then((client) => new CacheService(client));

/**
 * GET /api/balances/:chainId/:address
 * Get native token balance with caching
 */
router.get('/:chainId/:address', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.params.chainId, 10);
    const address = req.params.address.toLowerCase();
    const cacheService = await cacheServicePromise;

    // Check cache first
    const cacheKey = CacheKeys.balance(chainId, address);
    const cached = await cacheService.get<{ balance: string; balanceWei: string; timestamp: number }>(cacheKey);

    if (cached) {
      return res.json({
        balance: cached.balance,
        balanceWei: cached.balanceWei,
        balanceUSD: 0, // Client calculates with current price
        cached: true,
        timestamp: cached.timestamp,
      });
    }

    // Fetch from blockchain
    const result = await getBalance(chainId, address);

    if (!result) {
      return res.status(404).json({
        error: 'Balance not available',
        message: 'Could not fetch balance from blockchain',
      });
    }

    // Cache the result
    // Aligned with refresh interval: 10 minutes (600s) for better cache efficiency
    const cacheTTL = parseInt(process.env.CACHE_TTL_BALANCE || '600', 10);
    await cacheService.set(
      cacheKey,
      { balance: result.balance, balanceWei: result.balanceWei, timestamp: Date.now() },
      cacheTTL
    );

    res.json({
      balance: result.balance,
      balanceWei: result.balanceWei,
      balanceUSD: 0, // Client calculates with current price
      cached: false,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Balance fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/balances/batch
 * Get multiple native balances in one request
 * Body: { balances: [{ chainId, address }] }
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { balances } = req.body as { balances: Array<{ chainId: number; address: string }> };

    if (!Array.isArray(balances) || balances.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'balances must be a non-empty array',
      });
    }

    const cacheService = await cacheServicePromise;
    const results: Array<{
      chainId: number;
      address: string;
      balance: string | null;
      balanceWei: string | null;
      cached: boolean;
      error?: string;
    }> = [];
    const uncached: Array<{ chainId: number; address: string; index: number }> = [];

    // Check cache for all balances
    for (let i = 0; i < balances.length; i++) {
      const { chainId, address } = balances[i];
      const cacheKey = CacheKeys.balance(chainId, address.toLowerCase());
      const cached = await cacheService.get<{ balance: string; balanceWei: string; timestamp: number }>(cacheKey);

      if (cached) {
        results[i] = {
          chainId,
          address,
          balance: cached.balance,
          balanceWei: cached.balanceWei,
          cached: true,
        };
      } else {
        uncached.push({ chainId, address, index: i });
      }
    }

    // Fetch uncached balances
    if (uncached.length > 0) {
      const batchResults = await getBalancesBatch(
        uncached.map(({ chainId, address }) => ({ chainId, address }))
      );

      for (let i = 0; i < uncached.length; i++) {
        const { chainId, address, index } = uncached[i];
        const result = batchResults[i];

        if (result.balance && result.balanceWei) {
          const cacheKey = CacheKeys.balance(chainId, address.toLowerCase());
          const cacheTTL = parseInt(process.env.CACHE_TTL_BALANCE || '600', 10);
          await cacheService.set(
            cacheKey,
            { balance: result.balance, balanceWei: result.balanceWei, timestamp: Date.now() },
            cacheTTL
          );

          results[index] = {
            chainId,
            address,
            balance: result.balance,
            balanceWei: result.balanceWei,
            cached: false,
          };
        } else {
          results[index] = {
            chainId,
            address,
            balance: null,
            balanceWei: null,
            cached: false,
            error: result.error || 'Failed to fetch balance',
          };
        }
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('Batch balance fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
