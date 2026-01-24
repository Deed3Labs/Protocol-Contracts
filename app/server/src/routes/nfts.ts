import { Router, Request, Response } from 'express';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { getDeedNFTs, getGeneralNFTs, getAllNFTsMultiChain } from '../services/nftService.js';

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
  // Set timeout for this request (60 seconds)
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({
        error: 'Request timeout',
        message: 'NFT fetch took too long',
      });
    }
  }, 60000);

  // Handle request abort
  req.on('close', () => {
    clearTimeout(timeout);
  });

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
    // Note: We deliberately don't return early here to ensure we don't trigger "headers already sent"
    // The previous implementation had a race condition or logic error where it might try to send response twice
    
    if (cached) {
      clearTimeout(timeout);
      // Explicit return to stop execution
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
    // Aligned with refresh interval: 10 minutes (600s) - NFTs change less frequently
    const cacheTTL = parseInt(process.env.CACHE_TTL_NFT || '600', 10);
    await cacheService.set(
      cacheKey,
      { nfts, timestamp: Date.now() },
      cacheTTL
    );

    clearTimeout(timeout);
    // Only send response if headers haven't been sent yet
    if (!res.headersSent) {
      return res.json({
        nfts,
        cached: false,
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    clearTimeout(timeout);
    
    // Handle request abort gracefully
    if (error instanceof Error && (error.message.includes('aborted') || error.message.includes('ECONNABORTED'))) {
      // Request was aborted by client - don't log as error
      return;
    }
    
    console.error('NFT fetch error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
});

/**
 * POST /api/nfts/batch
 * Get NFTs for multiple addresses/chains in one request
 * Body: { requests: [{ chainId, address, contractAddress? }] }
 */
router.post('/batch', async (req: Request, res: Response) => {
  // Set timeout for batch requests (90 seconds)
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({
        error: 'Request timeout',
        message: 'Batch NFT fetch took too long',
      });
    }
  }, 90000);

  // Handle request abort
  req.on('close', () => {
    clearTimeout(timeout);
  });

  try {
    const { requests } = req.body as {
      requests: Array<{ chainId: number; address: string; contractAddress?: string }>;
    };

    if (!Array.isArray(requests) || requests.length === 0) {
      clearTimeout(timeout);
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

    clearTimeout(timeout);
    res.json({ results });
  } catch (error) {
    clearTimeout(timeout);
    
    // Handle request abort gracefully
    if (error instanceof Error && (error.message.includes('aborted') || error.message.includes('ECONNABORTED'))) {
      // Request was aborted by client - don't log as error
      return;
    }
    
    console.error('Batch NFT fetch error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
});

/**
 * POST /api/nfts/portfolio
 * Get ALL NFTs (ERC721, ERC1155) for multiple addresses and chains using Alchemy Portfolio API
 * This is the most efficient way to fetch NFTs across multiple chains in a single request
 * 
 * Body: { 
 *   requests: [{ address: string, chainIds: number[] }],
 *   withMetadata?: boolean,
 *   pageKey?: string,
 *   pageSize?: number,
 *   orderBy?: 'transferTime',
 *   sortOrder?: 'asc' | 'desc',
 *   excludeFilters?: Array<'SPAM' | 'AIRDROPS'>,
 *   includeFilters?: Array<'SPAM' | 'AIRDROPS'>,
 *   spamConfidenceLevel?: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW'
 * }
 * 
 * Limits: Maximum 2 addresses, 15 networks per address
 */
router.post('/portfolio', async (req: Request, res: Response) => {
  // Set timeout for portfolio requests (90 seconds)
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({
        error: 'Request timeout',
        message: 'Portfolio NFT fetch took too long',
      });
    }
  }, 90000);

  // Handle request abort
  req.on('close', () => {
    clearTimeout(timeout);
  });

  try {
    const { 
      requests,
      withMetadata,
      pageKey,
      pageSize,
      orderBy,
      sortOrder,
      excludeFilters,
      includeFilters,
      spamConfidenceLevel
    } = req.body as {
      requests: Array<{ address: string; chainIds: number[] }>;
      withMetadata?: boolean;
      pageKey?: string;
      pageSize?: number;
      orderBy?: 'transferTime';
      sortOrder?: 'asc' | 'desc';
      excludeFilters?: Array<'SPAM' | 'AIRDROPS'>;
      includeFilters?: Array<'SPAM' | 'AIRDROPS'>;
      spamConfidenceLevel?: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
    };

    if (!Array.isArray(requests) || requests.length === 0) {
      clearTimeout(timeout);
      return res.status(400).json({
        error: 'Invalid request',
        message: 'requests must be a non-empty array',
      });
    }

    // Validate limits: max 2 addresses, 15 networks per address
    if (requests.length > 2) {
      clearTimeout(timeout);
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Maximum 2 addresses allowed per request',
      });
    }

    for (const req of requests) {
      if (req.chainIds.length > 15) {
        clearTimeout(timeout);
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Maximum 15 networks per address allowed',
        });
      }
    }

    const cacheService = await cacheServicePromise;
    const results: Array<{
      address: string;
      chainId: number;
      nfts: any[];
      totalCount?: number;
      pageKey?: string;
      cached: boolean;
      error?: string;
    }> = [];

    // Check cache for all address/chain combinations
    const uncached: Array<{ address: string; chainIds: number[] }> = [];

    for (const { address, chainIds } of requests) {
      const addressLower = address.toLowerCase();
      const uncachedChainIds: number[] = [];

      for (const chainId of chainIds) {
        const cacheKey = CacheKeys.nftList(chainId, addressLower);
        const cached = await cacheService.get<{ nfts: any[]; timestamp: number }>(cacheKey);

        if (cached) {
          results.push({
            address: addressLower,
            chainId,
            nfts: cached.nfts,
            cached: true,
          });
        } else {
          uncachedChainIds.push(chainId);
        }
      }

      if (uncachedChainIds.length > 0) {
        uncached.push({ address: addressLower, chainIds: uncachedChainIds });
      }
    }

    // Fetch uncached NFTs using Portfolio API
    if (uncached.length > 0) {
      // Import Portfolio API service directly to get native format
      const { getNFTsByAddress } = await import('../services/portfolioService.js');
      
      const portfolioResults = await getNFTsByAddress(uncached, {
        withMetadata: withMetadata ?? true,
        pageKey,
        pageSize,
        orderBy,
        sortOrder,
        excludeFilters,
        includeFilters,
        spamConfidenceLevel,
      });

      // Process results and cache them - return Portfolio API format directly
      for (const { address, chainIds } of uncached) {
        const addressMap = portfolioResults.get(address);
        if (!addressMap) continue;

        for (const chainId of chainIds) {
          const chainData = addressMap.get(chainId);
          if (!chainData) continue;

          const { nfts, totalCount, pageKey: resultPageKey } = chainData;
          
          if (nfts.length > 0 || totalCount !== undefined) {
            // Cache the result (Portfolio API format)
            const cacheKey = CacheKeys.nftList(chainId, address);
            const cacheTTL = parseInt(process.env.CACHE_TTL_NFT || '600', 10);
            await cacheService.set(
              cacheKey,
              { nfts, timestamp: Date.now() },
              cacheTTL
            );

            results.push({
              address,
              chainId,
              nfts, // Portfolio API format - includes full metadata, images, attributes, etc.
              totalCount,
              pageKey: resultPageKey,
              cached: false,
            });
          }
        }
      }
    }

    clearTimeout(timeout);
    res.json({ results });
  } catch (error) {
    clearTimeout(timeout);
    
    // Handle request abort gracefully
    if (error instanceof Error && (error.message.includes('aborted') || error.message.includes('ECONNABORTED'))) {
      return;
    }
    
    console.error('Portfolio NFT fetch error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
});

export default router;
