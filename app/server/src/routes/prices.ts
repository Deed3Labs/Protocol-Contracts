import { Router, Request, Response } from 'express';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { getTokenPrice } from '../services/priceService.js';

const router = Router();
const cacheServicePromise = getRedisClient().then((client) => new CacheService(client));

/**
 * GET /api/prices/:chainId/:tokenAddress
 * Get token price with caching
 */
router.get('/:chainId/:tokenAddress', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.params.chainId, 10);
    const tokenAddress = req.params.tokenAddress.toLowerCase();
    const cacheService = await cacheServicePromise;

    // Check cache first
    const cacheKey = CacheKeys.tokenPrice(chainId, tokenAddress);
    const cached = await cacheService.get<{ price: number; timestamp: number }>(cacheKey);

    if (cached) {
      return res.json({
        price: cached.price,
        cached: true,
        timestamp: cached.timestamp,
      });
    }

    // Fetch price using Alchemy Prices API (optimized service)
    // Automatically handles chain-specific pricing and Ethereum mainnet fallback
    const price = await getTokenPrice(chainId, tokenAddress);

    if (!price || price === 0) {
      return res.status(404).json({
        error: 'Price not available',
        message: 'Could not fetch price from any source (including Ethereum mainnet fallback)',
      });
    }

    // Cache the result
    const cacheTTL = parseInt(process.env.CACHE_TTL_PRICE || '300', 10);
    await cacheService.set(
      cacheKey,
      { price, timestamp: Date.now() },
      cacheTTL
    );

    res.json({
      price,
      cached: false,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Price fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/prices/batch
 * Get multiple token prices in one request
 * Body: { prices: [{ chainId, tokenAddress }] }
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { prices } = req.body as { prices: Array<{ chainId: number; tokenAddress: string }> };

    if (!Array.isArray(prices) || prices.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'prices must be a non-empty array',
      });
    }

    const cacheService = await cacheServicePromise;
    const results: Array<{ chainId: number; tokenAddress: string; price: number | null; cached: boolean }> = [];
    const uncached: Array<{ chainId: number; tokenAddress: string; index: number }> = [];

    // Check cache for all prices
    for (let i = 0; i < prices.length; i++) {
      const { chainId, tokenAddress } = prices[i];
      const cacheKey = CacheKeys.tokenPrice(chainId, tokenAddress.toLowerCase());
      const cached = await cacheService.get<{ price: number; timestamp: number }>(cacheKey);

      if (cached) {
        results[i] = {
          chainId,
          tokenAddress,
          price: cached.price,
          cached: true,
        };
      } else {
        uncached.push({ chainId, tokenAddress, index: i });
      }
    }

    // Fetch uncached prices using Alchemy's native batch API
    // This is more efficient than individual requests and respects rate limits
    if (uncached.length > 0) {
      const { getAlchemyPricesBatch } = await import('../services/priceService.js');
      const priceMap = await getAlchemyPricesBatch(
        uncached.map(({ chainId, tokenAddress }) => ({ chainId, tokenAddress }))
      );

      const cacheTTL = parseInt(process.env.CACHE_TTL_PRICE || '300', 10);

      for (const { chainId, tokenAddress, index } of uncached) {
        const normalizedAddress = tokenAddress.toLowerCase();
        const price = priceMap.get(normalizedAddress) || null;

        if (price && price > 0) {
          const cacheKey = CacheKeys.tokenPrice(chainId, normalizedAddress);
          await cacheService.set(
            cacheKey,
            { price, timestamp: Date.now() },
            cacheTTL
          );
        }

        results[index] = {
          chainId,
          tokenAddress,
          price,
          cached: false,
        };
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('Batch price fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
