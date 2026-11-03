# RPC Request Optimization Guide

## Overview

The app now uses an optimized RPC request system to reduce API calls, prevent rate limiting (429 errors), and minimize credit/token usage with Alchemy and Infura.

## Key Optimizations

### 1. **Provider Pooling**
- **Before**: Created a new provider instance for every request
- **After**: Providers are cached and reused across requests
- **Benefit**: Reduces connection overhead and improves performance

### 2. **Request Batching**
- **Before**: Each token balance required a separate RPC call
- **After**: Multiple token balances are fetched in a single batch request
- **Benefit**: Reduces from N requests to 1 request (e.g., 4 tokens = 1 batch call instead of 4 individual calls)

### 3. **Request Caching**
- **Before**: Every refresh made new RPC calls
- **After**: Results are cached for 5-30 seconds (depending on data type)
- **Benefit**: Avoids duplicate requests when data hasn't changed

### 4. **Rate Limiting**
- **Before**: No rate limiting, could easily hit 429 errors
- **After**: Automatic throttling (max 10 requests/second per chain)
- **Benefit**: Prevents rate limit errors and quota exhaustion

### 5. **Smart Retry Logic**
- **Before**: Simple retry or immediate failure
- **After**: Exponential backoff for 429 errors (1s, 2s, 4s delays)
- **Benefit**: Automatically recovers from temporary rate limits

## How It Works

### Provider Pooling
```typescript
// Providers are cached by chain ID
const provider = getCachedProvider(chainId); // Reuses existing provider
```

### Request Batching
```typescript
// Instead of:
const balance1 = await contract1.balanceOf(address);
const balance2 = await contract2.balanceOf(address);
const balance3 = await contract3.balanceOf(address);

// We do:
const balances = await executeBatchRpcCalls(chainId, [
  { method: 'eth_call', params: [...], id: 0 },
  { method: 'eth_call', params: [...], id: 1 },
  { method: 'eth_call', params: [...], id: 2 },
]);
```

### Request Caching
```typescript
// First call: Makes RPC request
const balance = await getBalanceOptimized(chainId, address);

// Second call within 10 seconds: Returns cached result
const balance2 = await getBalanceOptimized(chainId, address); // No RPC call!
```

## Cache TTL (Time To Live)

Different data types have different cache durations:

- **Native Balances**: 10 seconds
- **Token Balances**: 5 seconds
- **NFT Data**: 30 seconds
- **Transaction History**: 5 seconds

## Rate Limiting Configuration

Current settings (can be adjusted in `rpcOptimizer.ts`):

```typescript
const RATE_LIMIT_WINDOW = 1000; // 1 second window
const MAX_REQUESTS_PER_WINDOW = 10; // Max 10 requests per second per chain
```

This means:
- Each chain can make up to 10 requests per second
- Requests are automatically throttled if limit is reached
- Throttling is per-chain (different chains don't affect each other)

## Performance Improvements

### Before Optimization
- **4 chains × 4 tokens = 16 RPC calls** (plus metadata calls)
- **Refresh every 30 seconds = ~32 calls/minute**
- **High risk of 429 errors** during peak usage

### After Optimization
- **4 chains × 1 batch call = 4 RPC calls** (for token balances)
- **Caching reduces duplicate calls by ~80%**
- **Rate limiting prevents 429 errors**
- **Estimated 70-80% reduction in API calls**

## Example: Token Balance Fetching

### Before (Inefficient)
```typescript
// 4 separate RPC calls
for (const token of tokens) {
  const balance = await contract.balanceOf(address); // RPC call 1
  const symbol = await contract.symbol(); // RPC call 2
  const name = await contract.name(); // RPC call 3
  const decimals = await contract.decimals(); // RPC call 4
}
// Total: 16 RPC calls for 4 tokens
```

### After (Optimized)
```typescript
// 1 batch RPC call for all balances
const balances = await executeBatchRpcCalls(chainId, balanceCalls);

// Then fetch metadata only for tokens with balance (reduces calls)
// Total: ~5-8 RPC calls for 4 tokens (60-70% reduction)
```

## Monitoring

The optimizer includes built-in monitoring:

- **Request tracking**: Tracks requests per chain
- **Cache hit rate**: Can be monitored via cache size
- **Rate limit detection**: Automatically handles 429 errors

## Configuration

You can adjust settings in `app/src/utils/rpcOptimizer.ts`:

```typescript
// Rate limiting
const RATE_LIMIT_WINDOW = 1000; // Adjust window size
const MAX_REQUESTS_PER_WINDOW = 10; // Adjust max requests

// Caching
const CACHE_TTL = 5000; // Default cache TTL (5 seconds)

// Retry logic
const MAX_RETRIES = 3; // Number of retry attempts
```

## Best Practices

1. **Use batch calls** for multiple similar requests
2. **Set appropriate cache TTLs** based on data freshness needs
3. **Monitor rate limits** in your provider dashboard
4. **Adjust rate limits** based on your provider's limits:
   - Infura: ~100 requests/second (free tier: ~10/second)
   - Alchemy: ~330 requests/second (free tier: ~10/second)

## Troubleshooting

### Still Getting 429 Errors?
1. Reduce `MAX_REQUESTS_PER_WINDOW` in `rpcOptimizer.ts`
2. Increase cache TTLs to reduce request frequency
3. Check your provider's actual rate limits

### Too Slow?
1. Reduce cache TTLs (but increases API calls)
2. Increase `MAX_REQUESTS_PER_WINDOW` (but increases risk of 429)
3. Use batch calls more aggressively

### High API Usage?
1. Increase cache TTLs
2. Reduce refresh frequency (currently 30 seconds)
3. Implement more aggressive batching

## Future Enhancements

Potential improvements:
- **Request deduplication**: Detect and merge identical pending requests
- **Adaptive rate limiting**: Automatically adjust based on provider responses
- **Request queuing**: Queue requests when at rate limit instead of failing
- **Provider health monitoring**: Switch providers if one is rate-limited
- **Predictive caching**: Pre-fetch likely-needed data
