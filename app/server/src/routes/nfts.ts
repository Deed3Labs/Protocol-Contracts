import { Router, Request, Response } from 'express';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { getDeedNFTs } from '../services/nftService.js';

const router = Router();
const cacheServicePromise = getRedisClient().then((client) => new CacheService(client));

/**
 * GET /api/nfts/:chainId/:address
 * Get DeedNFTs for an address with caching
 */
router.get('/:chainId/:address', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.params.chainId, 10);
    const address = req.params.address.toLowerCase();
    const contractAddress = req.query.contractAddress as string | undefined;
    const cacheService = await cacheServicePromise;

    // Check cache first
    const cacheKey = CacheKeys.nftList(chainId, address);
    const cached = await cacheService.get<{ nfts: any[]; timestamp: number }>(cacheKey);

    if (cached) {
      return res.json({
        nfts: cached.nfts,
        cached: true,
        timestamp: cached.timestamp,
      });
    }

    // Fetch from blockchain
    const nfts = await getDeedNFTs(chainId, address, contractAddress);

    // Cache the result
    const cacheTTL = parseInt(process.env.CACHE_TTL_NFT || '600', 10);
    await cacheService.set(
      cacheKey,
      { nfts, timestamp: Date.now() },
      cacheTTL
    );

    res.json({
      nfts,
      cached: false,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('NFT fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/nfts/batch
 * Get NFTs for multiple addresses/chains in one request
 * Body: { requests: [{ chainId, address, contractAddress? }] }
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { requests } = req.body as {
      requests: Array<{ chainId: number; address: string; contractAddress?: string }>;
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
      nfts: any[];
      cached: boolean;
      error?: string;
    }> = [];
    const uncached: Array<{ chainId: number; address: string; contractAddress?: string; index: number }> = [];

    // Check cache for all requests
    for (let i = 0; i < requests.length; i++) {
      const { chainId, address } = requests[i];
      const cacheKey = CacheKeys.nftList(chainId, address.toLowerCase());
      const cached = await cacheService.get<{ nfts: any[]; timestamp: number }>(cacheKey);

      if (cached) {
        results[i] = {
          chainId,
          address,
          nfts: cached.nfts,
          cached: true,
        };
      } else {
        uncached.push({ ...requests[i], index: i });
      }
    }

    // Fetch uncached NFTs
    for (const { chainId, address, contractAddress, index } of uncached) {
      try {
        const nfts = await getDeedNFTs(chainId, address, contractAddress);

        const cacheKey = CacheKeys.nftList(chainId, address.toLowerCase());
        const cacheTTL = parseInt(process.env.CACHE_TTL_NFT || '600', 10);
        await cacheService.set(
          cacheKey,
          { nfts, timestamp: Date.now() },
          cacheTTL
        );

        results[index] = {
          chainId,
          address,
          nfts,
          cached: false,
        };
      } catch (error) {
        results[index] = {
          chainId,
          address,
          nfts: [],
          cached: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('Batch NFT fetch error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
