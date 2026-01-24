# API Testing Guide

## Quick Test

Run the test script to verify all endpoints:

```bash
cd app/server
npm run test
```

Or manually:

```bash
bun test-api.ts
```

## Manual Testing

### 1. Health Check
```bash
curl http://localhost:3001/health
```

Expected: `{"status":"ok","redis":"connected","timestamp":"..."}`

### 2. Get Token Price
```bash
curl http://localhost:3001/api/prices/1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
```

Expected: `{"price":2500.50,"cached":false,"timestamp":...}`

### 3. Get Balance
```bash
curl http://localhost:3001/api/balances/1/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

Expected: `{"balance":"123.4567","balanceWei":"123456789000000000000","cached":false}`

### 4. Get Token Balance
```bash
curl http://localhost:3001/api/token-balances/1/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

Expected: `{"address":"0x...","symbol":"USDC","balance":"100.0","cached":false}`

### 5. Get Transactions
```bash
curl http://localhost:3001/api/transactions/1/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045?limit=5
```

Expected: `{"transactions":[...],"cached":false}`

## Testing Cache

1. Make a request (should return `"cached": false`)
2. Make the same request again immediately (should return `"cached": true`)

## Testing from Frontend

1. Open browser console
2. Check for `checkServerHealth()` calls
3. Verify API calls are going to your Railway URL
4. Check Network tab for API requests

## Common Issues

### Server not responding
- Check Railway logs
- Verify server is running: `curl https://your-server.railway.app/health`
- Check environment variables in Railway

### CORS errors
- Verify `CORS_ORIGIN` is set in Railway
- Check that your Vercel domain is allowed

### Redis connection errors
- Verify `REDIS_URL` is set correctly in Railway
- Check Upstash dashboard to ensure database is active
