# Frontend Integration Guide

This guide explains how to integrate the backend server with your React frontend.

## Setup

1. **Start the server:**
   ```bash
   cd server
   npm install
   npm run dev
   ```

2. **Update frontend environment variables:**
   Add to your `.env` file:
   ```bash
   VITE_API_BASE_URL=http://localhost:3001
   ```

3. **Use the API client in your hooks:**
   Replace direct API calls with the server API client.

## Example: Updating usePricingData Hook

### Before (direct API calls):
```typescript
// In usePricingData.ts
const tokenPrice = await getUniswapPrice(provider, targetTokenAddress, chainId);
if (!tokenPrice) {
  tokenPrice = await getCoinGeckoPrice(targetTokenAddress, chainId);
}
```

### After (using server API):
```typescript
// In usePricingData.ts
import { getTokenPrice } from '@/utils/apiClient';

// Replace the fetch logic with:
const priceData = await getTokenPrice(chainId, targetTokenAddress);
if (priceData) {
  setPrice(priceData.price);
} else {
  // Fallback to direct calls if server is unavailable
  const tokenPrice = await getUniswapPrice(provider, targetTokenAddress, chainId);
  // ...
}
```

## Benefits

1. **Shared Caching**: All users benefit from cached prices
2. **Reduced API Calls**: Fewer calls to CoinGecko and RPC providers
3. **Better Performance**: Faster response times for cached data
4. **Rate Limit Protection**: Server manages rate limits centrally

## Migration Strategy

1. **Phase 1**: Add server alongside existing frontend code
2. **Phase 2**: Update hooks to use server API with fallback
3. **Phase 3**: Monitor usage and gradually remove direct API calls
4. **Phase 4**: Add more endpoints (balances, NFTs, transactions)

## Fallback Strategy

Always implement fallback to direct API calls:
- If server is unavailable
- If server returns an error
- For critical user operations

This ensures your app continues to work even if the server is down.
