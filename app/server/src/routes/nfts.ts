import { Router, Request, Response } from 'express';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { getDeedNFTs, getGeneralNFTs } from '../services/nftService.js';

const router = Router();
const cacheServicePromise = getRedisClient().then((client) => new CacheService(client));

/**
 * GET /api/nfts/:chainId/:address
 * Get NFTs for an address with caching
 * 
 * Query parameters:
 * - contractAddress: Optional. If provided, fetches general ERC721 NFTs from that contract.
 *                     If not provided, fetches T-Deeds (DeedNFT protocol contracts).
 * - type: Optional. 't-deed' or 'general'. Defaults to 't-deed' if contractAddress not provided.
 */
router.get('/:chainId/:address', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.params.chainId, 10);
    const address = req.params.address.toLowerCase();
    const contractAddress = req.query.contractAddress as string | undefined;
    const nftType = (req.query.type as string) || (contractAddress ? 'general' : 't-deed');
    const cacheService = await cacheServicePromise;

    // Check cache first
    const cacheKey = contractAddress 
      ? CacheKeys.nftList(chainId, address, contractAddress)
      : CacheKeys.nftList(chainId, address);
    const cached = await cacheService.get<{ nfts: any[]; timestamp: number }>(cacheKey);

    if (cached) {
      return res.json({
        nfts: cached.nfts,
        cached: true,
        timestamp: cached.timestamp,
      });
    }

    // Fetch from blockchain
    let nfts: any[];
    if (contractAddress && nftType === 'general') {
      // Fetch general ERC721 NFTs from specified contract
      nfts = await getGeneralNFTs(chainId, address, contractAddress);
    } else {
      // Fetch T-Deeds (protocol-controlled DeedNFT contracts)
      nfts = await getDeedNFTs(chainId, address, contractAddress);
    }

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
        // Determine if this is a general NFT request or T-Deed request
        const nftType = contractAddress ? 'general' : 't-deed';
        let nfts: any[];
        
        if (contractAddress && nftType === 'general') {
          // Fetch general ERC721 NFTs from specified contract
          nfts = await getGeneralNFTs(chainId, address, contractAddress);
        } else {
          // Fetch T-Deeds (protocol-controlled DeedNFT contracts)
          nfts = await getDeedNFTs(chainId, address, contractAddress);
        }

        const cacheKey = CacheKeys.nftList(chainId, address.toLowerCase(), contractAddress);
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
