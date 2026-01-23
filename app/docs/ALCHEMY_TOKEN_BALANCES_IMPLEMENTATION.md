# Alchemy getAllTokenBalances Implementation

## Overview

We've implemented Alchemy's `getTokenBalances` API to fetch **ALL ERC-20 tokens** a user owns across all supported networks, with automatic pricing and fallback support.

## What Changed

### 1. Server-Side Implementation

**File: `app/server/src/services/balanceService.ts`**
- Added `getAllTokenBalances()` function that uses Alchemy's REST API
- Calls `alchemy_getTokenBalances` with `"erc20"` parameter to get ALL tokens
- Fetches token metadata (symbol, name, decimals) via RPC
- Processes tokens in batches to avoid overwhelming RPC

**File: `app/server/src/routes/tokenBalances.ts`**
- Added `GET /api/token-balances/all/:chainId/:userAddress` endpoint
- Added `POST /api/token-balances/all/batch` endpoint for batch requests
- Both endpoints include Redis caching

**File: `app/server/src/utils/rpc.ts`**
- Added `getAlchemyRestUrl()` function to get Alchemy REST API URLs

### 2. Client-Side Implementation

**File: `app/src/utils/apiClient.ts`**
- Added `getAllTokenBalances()` function
- Added `getAllTokenBalancesBatch()` function for batch requests

**File: `app/src/hooks/useMultichainBalances.ts`**
- Updated `fetchChainTokens()` to:
  1. **First try**: Use Alchemy API to get ALL tokens
  2. **Fallback**: Use `COMMON_TOKENS` approach if Alchemy API unavailable
  3. **Pricing**: Still fetches prices for all discovered tokens
  4. **Metadata**: Uses `COMMON_TOKENS` for logo URLs and prioritization

## How It Works

### Flow Diagram

```
1. User connects wallet
   ↓
2. useMultichainBalances calls fetchChainTokens() for each chain
   ↓
3. For each chain:
   a. Try getAllTokenBalances() (Alchemy API)
      - Calls: POST /api/token-balances/all/:chainId/:userAddress
      - Server calls Alchemy: alchemy_getTokenBalances(address, "erc20")
      - Returns: ALL tokens user owns
   b. If Alchemy unavailable, fallback to COMMON_TOKENS
      - Calls: POST /api/token-balances/batch
      - Only checks tokens in COMMON_TOKENS list
   ↓
4. For each token:
   - Get price via getTokenPrice()
   - Use COMMON_TOKENS for logoUrl if available
   - Calculate balanceUSD
   ↓
5. Sort by USD value (known tokens first)
   ↓
6. Display in UI
```

## Benefits

### ✅ Complete Coverage
- **Before**: Only ~4-5 tokens per chain (from `COMMON_TOKENS`)
- **After**: ALL tokens user owns (via Alchemy API)

### ✅ Efficiency
- **Before**: Multiple RPC calls (one per token in `COMMON_TOKENS`)
- **After**: One Alchemy API call per chain

### ✅ Pricing
- **Still works**: All discovered tokens get prices via `getTokenPrice()`
- Uses token address and symbol for price lookup

### ✅ Fallback Support
- If Alchemy API unavailable, falls back to `COMMON_TOKENS` approach
- No breaking changes - works with or without Alchemy API key

### ✅ Metadata Enhancement
- Uses `COMMON_TOKENS` for logo URLs when available
- Prioritizes known tokens (from `COMMON_TOKENS`) in UI

## Configuration

### Required: Alchemy API Key

Set in `app/server/.env`:
```bash
ALCHEMY_API_KEY=your_alchemy_api_key_here
```

Get your free API key at: https://dashboard.alchemy.com/

### Supported Chains

The implementation automatically supports all chains that Alchemy supports:
- ✅ Ethereum Mainnet (1)
- ✅ Base Mainnet (8453)
- ✅ Polygon (137)
- ✅ Arbitrum One (42161)
- ✅ Gnosis (100)
- ✅ Sepolia Testnet (11155111)
- ✅ Base Sepolia (84532)
- ✅ Polygon Mumbai (80001)

## API Endpoints

### Get All Tokens (Single Chain)
```bash
GET /api/token-balances/all/:chainId/:userAddress
```

**Response:**
```json
{
  "tokens": [
    {
      "address": "0x...",
      "symbol": "USDC",
      "name": "USD Coin",
      "decimals": 6,
      "balance": "1000.0",
      "balanceRaw": "1000000000"
    }
  ],
  "cached": false,
  "timestamp": 1234567890
}
```

### Get All Tokens (Batch)
```bash
POST /api/token-balances/all/batch
Body: {
  "requests": [
    { "chainId": 1, "userAddress": "0x..." },
    { "chainId": 8453, "userAddress": "0x..." }
  ]
}
```

## Testing

### Test Alchemy API Integration

1. **Set Alchemy API Key**:
   ```bash
   cd app/server
   echo "ALCHEMY_API_KEY=your_key" >> .env
   ```

2. **Test Single Chain**:
   ```bash
   curl http://localhost:3001/api/token-balances/all/1/0xYOUR_ADDRESS
   ```

3. **Test Batch**:
   ```bash
   curl -X POST http://localhost:3001/api/token-balances/all/batch \
     -H "Content-Type: application/json" \
     -d '{"requests":[{"chainId":1,"userAddress":"0xYOUR_ADDRESS"}]}'
   ```

### Verify in Frontend

1. Connect wallet
2. Check browser console for token fetching
3. Verify all tokens appear in portfolio (not just COMMON_TOKENS)
4. Verify pricing works for all tokens

## Migration Notes

### Backward Compatibility

- ✅ **Fully backward compatible**
- ✅ Works without Alchemy API key (falls back to `COMMON_TOKENS`)
- ✅ No breaking changes to existing code

### Performance Impact

- **Faster**: One API call instead of multiple RPC calls
- **More complete**: Shows all tokens, not just `COMMON_TOKENS`
- **Better UX**: Users see their complete portfolio

## Troubleshooting

### Alchemy API Not Working

**Symptoms**: Only `COMMON_TOKENS` appear, not all tokens

**Solutions**:
1. Check `ALCHEMY_API_KEY` is set in `app/server/.env`
2. Verify API key is valid at https://dashboard.alchemy.com/
3. Check server logs for Alchemy API errors
4. Verify chain is supported by Alchemy

### Missing Token Prices

**Symptoms**: Tokens appear but show $0 value

**Solutions**:
1. Check `getTokenPrice()` is working (uses Uniswap/CoinGecko)
2. Verify token has liquidity/pricing data
3. Check network tab for price API calls

### Slow Performance

**Symptoms**: Token fetching takes too long

**Solutions**:
1. Check Redis caching is enabled
2. Verify batch processing is working
3. Check Alchemy API rate limits
4. Consider increasing cache TTL

## Next Steps

1. ✅ **Done**: Implement Alchemy API integration
2. ✅ **Done**: Add fallback to `COMMON_TOKENS`
3. ✅ **Done**: Ensure pricing works for all tokens
4. ✅ **Done**: Test across all supported networks
5. 🔄 **Optional**: Add token filtering/grouping UI
6. 🔄 **Optional**: Add token search functionality
