# Quick Test Guide

## ✅ All Hooks Updated

All 7 data-fetching hooks now use the server API:

1. ✅ `usePricingData` - Token prices
2. ✅ `useMultichainBalances` - Native balances
3. ✅ `useMultichainTokenBalances` - ERC20 token balances
4. ✅ `useMultichainActivity` - Transactions
5. ✅ `useMultichainDeedNFTs` - NFTs
6. ✅ `useWalletBalance` - Single-chain native balance
7. ✅ `useTokenBalances` - Single-chain token balances

## Run Tests

### Option 1: Automated Test Script

```bash
cd app/server
npm run test
```

This will test all endpoints and show results.

### Option 2: Manual Testing

**1. Start server locally:**
```bash
cd app/server
npm run dev
```

**2. Test health:**
```bash
curl http://localhost:3001/health
```

**3. Test price (should cache on second call):**
```bash
# First call - not cached
curl http://localhost:3001/api/prices/1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2

# Second call - should be cached
curl http://localhost:3001/api/prices/1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
```

Look for `"cached": true` in the second response.

### Option 3: Test from Frontend

1. **Set environment variable:**
   ```bash
   # In app/.env
   VITE_API_BASE_URL=http://localhost:3001
   ```

2. **Start frontend:**
   ```bash
   cd app
   npm run dev
   ```

3. **Check browser console:**
   - Should see server health checks
   - API calls to `http://localhost:3001`
   - No CORS errors

4. **Check Network tab:**
   - Requests to `/api/prices/...`
   - Requests to `/api/balances/...`
   - Responses with `"cached": true/false`

## Production Testing

After deploying to Railway:

1. **Test health:**
   ```bash
   curl https://your-server.railway.app/health
   ```

2. **Update frontend .env:**
   ```
   VITE_API_BASE_URL=https://your-server.railway.app
   ```

3. **Redeploy frontend on Vercel**

4. **Check browser console:**
   - Should see successful API calls
   - Cached responses on repeat requests

## What to Look For

✅ **Success Indicators:**
- Health check returns `{"status":"ok"}`
- API responses include `"cached": true` on second request
- No CORS errors in browser console
- Faster response times for cached data

❌ **Issues to Watch:**
- HTML responses instead of JSON (server not running)
- CORS errors (check CORS_ORIGIN in Railway)
- Redis connection errors (check REDIS_URL)
- 502 errors (check Railway logs)

## Next Steps

1. ✅ All hooks updated
2. ✅ Test script created
3. ⏭️ Deploy to Railway
4. ⏭️ Test in production
5. ⏭️ Monitor performance
