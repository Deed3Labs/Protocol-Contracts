import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { getTokenPrice } from '../services/priceService.js';
import { websocketService } from '../services/websocketService.js';

/**
 * Background job to update token prices
 * Runs every 5 minutes using Bun's built-in cron
 * 
 * Purpose:
 * - Caches prices for common tokens in Redis for fast access
 * - Provides real-time price updates via WebSocket
 * - Used by standalone price queries (/api/prices endpoint)
 * 
 * NOTE: Portfolio API endpoints (/api/token-balances/portfolio) include prices
 * in their response, so this job is primarily for:
 * - Standalone price lookups
 * - WebSocket real-time updates
 * - Caching common token prices for quick access
 * 
 * Now covers all common tokens across all chains, not just popular ones
 */
export async function startPriceUpdater() {
  const cacheService = await getRedisClient().then((client) => new CacheService(client));

  // All common tokens across all supported chains
  const allTokens = [
    // Ethereum Mainnet
    { chainId: 1, tokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }, // WETH
    { chainId: 1, tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, // USDC
    { chainId: 1, tokenAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, // USDT
    { chainId: 1, tokenAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F' }, // DAI
    // Base Mainnet
    { chainId: 8453, tokenAddress: '0x4200000000000000000000000000000000000006' }, // WETH
    { chainId: 8453, tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }, // USDC
    // Base Sepolia
    { chainId: 84532, tokenAddress: '0x4200000000000000000000000000000000000006' }, // WETH
    { chainId: 84532, tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' }, // USDC
    // Sepolia
    { chainId: 11155111, tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' }, // USDC
    // Arbitrum One
    { chainId: 42161, tokenAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' }, // WETH
    { chainId: 42161, tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' }, // USDC
    { chainId: 42161, tokenAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' }, // USDT
    { chainId: 42161, tokenAddress: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1' }, // DAI
    // Polygon
    { chainId: 137, tokenAddress: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' }, // WETH
    { chainId: 137, tokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' }, // USDC
    { chainId: 137, tokenAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' }, // USDT
    { chainId: 137, tokenAddress: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063' }, // DAI
    { chainId: 137, tokenAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' }, // WMATIC
    // Gnosis
    { chainId: 100, tokenAddress: '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83' }, // USDC
    { chainId: 100, tokenAddress: '0x4ECaBa5870353805a9F068101A40E0f32ed605C6' }, // USDT
    { chainId: 100, tokenAddress: '0xe91D153E0b41518A2Ce8Dd3D7944F8638934d2C8' }, // WXDAI
  ];

  // Price update function
  async function updatePrices() {
    console.log(`🔄 Updating token prices for ${allTokens.length} tokens...`);

    for (const { chainId, tokenAddress } of allTokens) {
      try {
        // Use Alchemy Prices API (simplified - handles all fallbacks internally)
        const price = await getTokenPrice(chainId, tokenAddress);

        if (price && price > 0) {
          const cacheKey = CacheKeys.tokenPrice(chainId, tokenAddress);
          const cacheTTL = parseInt(process.env.CACHE_TTL_PRICE || '300', 10);
          await cacheService.set(
            cacheKey,
            { price, timestamp: Date.now() },
            cacheTTL
          );
          console.log(`✅ Updated price for ${tokenAddress} on chain ${chainId}: $${price}`);
          
          // Broadcast price update via WebSocket
          try {
            await websocketService.broadcastPriceUpdate(chainId, tokenAddress, price);
          } catch (error) {
            // WebSocket broadcast failure is not critical
            console.warn(`Failed to broadcast price update via WebSocket:`, error);
          }
        }
      } catch (error) {
        console.error(`Error updating price for ${tokenAddress}:`, error);
      }
    }

    console.log(`✅ Price update complete for ${allTokens.length} tokens`);
  }

  // Run every 5 minutes using setInterval (5 minutes = 300000ms)
  setInterval(async () => {
    await updatePrices();
  }, 5 * 60 * 1000); // 5 minutes

  // Run initial update immediately
  await updatePrices();

  console.log(`✅ Price updater job started (runs every 5 minutes, updating ${allTokens.length} tokens)`);
}
