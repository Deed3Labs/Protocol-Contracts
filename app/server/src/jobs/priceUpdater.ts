import cron from 'node-cron';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { getUniswapPrice, getCoinGeckoPrice } from '../services/priceService.js';

/**
 * Background job to update popular token prices
 * Runs every 5 minutes
 */
export async function startPriceUpdater() {
  const cacheService = await getRedisClient().then((client) => new CacheService(client));

  // Popular tokens to keep updated
  const popularTokens = [
    { chainId: 1, tokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }, // WETH
    { chainId: 8453, tokenAddress: '0x4200000000000000000000000000000000000006' }, // WETH Base
    { chainId: 1, tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, // USDC
    { chainId: 8453, tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }, // USDC Base
  ];

  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('🔄 Updating popular token prices...');

    for (const { chainId, tokenAddress } of popularTokens) {
      try {
        let price: number | null = null;

        // Try Uniswap first
        try {
          price = await getUniswapPrice(chainId, tokenAddress);
        } catch (error) {
          console.error(`Error fetching Uniswap price for ${tokenAddress}:`, error);
        }

        // Fallback to CoinGecko
        if (!price || price === 0) {
          try {
            price = await getCoinGeckoPrice(chainId, tokenAddress);
          } catch (error) {
            console.error(`Error fetching CoinGecko price for ${tokenAddress}:`, error);
          }
        }

        if (price && price > 0) {
          const cacheKey = CacheKeys.tokenPrice(chainId, tokenAddress);
          const cacheTTL = parseInt(process.env.CACHE_TTL_PRICE || '300', 10);
          await cacheService.set(
            cacheKey,
            { price, timestamp: Date.now() },
            cacheTTL
          );
          console.log(`✅ Updated price for ${tokenAddress} on chain ${chainId}: $${price}`);
        }
      } catch (error) {
        console.error(`Error updating price for ${tokenAddress}:`, error);
      }
    }

    console.log('✅ Price update complete');
  });

  console.log('✅ Price updater job started (runs every 5 minutes)');
}
