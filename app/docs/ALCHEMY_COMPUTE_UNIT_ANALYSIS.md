# Alchemy Compute Unit Consumption Analysis

## Summary
You've consumed over 2M compute units since last night. This document identifies the main sources of high compute unit consumption.

## Major Compute Unit Consumers

### 🔴 **CRITICAL: TransfersService (Highest Impact)**

**Location**: `app/server/src/services/transfersService.ts`

**Problem**: 
- Checks transfers **every 30 seconds** for each monitored address
- Monitors **7 chains** per address: `[1, 8453, 137, 42161, 100, 11155111, 84532]`
- Makes **2 API calls per check** (fromAddress + toAddress)
- Uses Alchemy Transfers API (`alchemy_getAssetTransfers`)

**Compute Unit Calculation**:
- Per address: 7 chains × 2 calls × 2 checks/minute = **28 calls/minute per address**
- Per hour: 28 × 60 = **1,680 calls/hour per address**
- Per day: 1,680 × 24 = **40,320 calls/day per address**

**If you have 2 addresses monitored**:
- **80,640 calls/day** = ~2.4M compute units/day (assuming ~30 compute units per call)

**Recommendations**:
1. **Increase interval from 30s to 5 minutes** (10x reduction)
   - Current: 28 calls/minute
   - After: 2.8 calls/minute
   - Savings: **90% reduction**

2. **Only monitor active chains** (not all 7 chains)
   - If user only uses Base, only monitor Base
   - Savings: **85% reduction** (1 chain vs 7 chains)

3. **Use incremental block tracking** (already implemented but verify it's working)
   - Should only fetch new blocks, not full history each time

4. **Add debouncing** - Skip checks if no new blocks since last check

---

### 🟠 **HIGH: WebSocket Service Polling**

**Location**: `app/server/src/services/websocketService.ts`

**Current Intervals**:
1. **Balances/Transactions**: Every **30 seconds** (line 176)
2. **NFTs**: Every **5 minutes** (line 205) ✅ Already optimized
3. **Prices**: Every **1 minute** (line 231)

**Compute Unit Impact**:
- **Balances**: Uses `getBalance()` which may use Alchemy RPC
- **Transactions**: Uses `transfersService.getTransactions()` which uses Alchemy Transfers API
- **Prices**: Uses `getTokenPrice()` which uses Alchemy Prices API

**Per connected client**:
- Balances: 2 checks/minute × 4 chains (default) = 8 calls/minute
- Transactions: 2 checks/minute × 4 chains = 8 calls/minute  
- Prices: 1 check/minute × 4 tokens = 4 calls/minute
- **Total: ~20 calls/minute per client**

**Recommendations**:
1. **Increase balance/transaction interval to 2 minutes** (4x reduction)
2. **Increase price interval to 5 minutes** (5x reduction)
3. **Only poll when WebSocket is actively connected** (already implemented)
4. **Use cache more aggressively** - Check cache TTL before making API calls

---

### 🟡 **MEDIUM: Price Updater Background Job**

**Location**: `app/server/src/jobs/priceUpdater.ts`

**Current Behavior**:
- Runs every **5 minutes**
- Updates **~20 tokens** across multiple chains
- Uses Alchemy Prices API

**Compute Unit Impact**:
- 20 tokens × 12 times/hour = **240 calls/hour**
- Per day: 240 × 24 = **5,760 calls/day**

**Recommendations**:
1. **Increase interval to 15 minutes** (3x reduction)
   - Prices don't change that frequently
   - Savings: **~3,840 calls/day**

2. **Only update tokens that are actively held by users**
   - Track which tokens users actually own
   - Don't update unused tokens

3. **Use Portfolio API prices** when available (already included in Portfolio API responses)

---

### 🟡 **MEDIUM: Frontend Auto-Refresh**

**Location**: `app/src/context/PortfolioContext.tsx`

**Current Behavior**:
- Auto-refresh every **10 minutes** (if no WebSocket) or **30 minutes** (if WebSocket connected)
- Triggers full portfolio fetch:
  - `useMultichainBalances` → `getAllTokenBalances` (Alchemy API)
  - `usePortfolioHoldings` → Portfolio API (uses Alchemy)
  - `useMultichainActivity` → Transfers API

**Compute Unit Impact**:
- Per user session: ~6-12 refreshes/hour
- Each refresh: Multiple API calls (balances, NFTs, transactions)
- **~50-100 calls per refresh**

**Recommendations**:
1. **Increase interval to 30 minutes** (no WebSocket) or **60 minutes** (with WebSocket)
2. **Only refresh when tab is active** (use Page Visibility API)
3. **Use WebSocket updates instead of polling** (already implemented, but verify it's working)

---

### 🟢 **LOW: Portfolio API Calls**

**Location**: `app/server/src/services/portfolioService.ts`

**Current Behavior**:
- Used when fetching holdings via `/api/token-balances/portfolio`
- Rate limited to 5 req/sec (200ms delay)
- Batch requests (max 2 addresses, 5 networks)

**Compute Unit Impact**:
- Relatively efficient due to batching
- Only called on-demand (not polling)

**Recommendations**:
- Already optimized with rate limiting and batching
- Consider caching results longer (currently 10s-600s TTL)

---

## Immediate Action Items (Priority Order)

### 1. **Fix TransfersService (CRITICAL - 90% reduction possible)**
```typescript
// app/server/src/services/transfersService.ts
// Line 103: Change from 30 seconds to 5 minutes
const interval = setInterval(async () => {
  await this.checkTransfers(address, chainId);
}, 5 * 60 * 1000); // 5 minutes instead of 30000
```

### 2. **Optimize WebSocket Service Intervals**
```typescript
// app/server/src/services/websocketService.ts
// Line 176: Increase balance/transaction interval
}, 2 * 60 * 1000); // 2 minutes instead of 30000

// Line 231: Increase price interval
}, 5 * 60 * 1000); // 5 minutes instead of 60000
```

### 3. **Optimize Price Updater**
```typescript
// app/server/src/jobs/priceUpdater.ts
// Line 93: Increase interval
}, 15 * 60 * 1000); // 15 minutes instead of 5 minutes
```

### 4. **Optimize Frontend Auto-Refresh**
```typescript
// app/src/context/PortfolioContext.tsx
// Line 269: Increase interval when no WebSocket
}, 30 * 60 * 1000); // 30 minutes instead of 10 minutes

// Line 262: Increase backup interval
}, 60 * 60 * 1000); // 60 minutes instead of 30 minutes
```

---

## Expected Savings

After implementing all recommendations:

| Component | Current (calls/day) | After (calls/day) | Savings |
|-----------|-------------------|-------------------|---------|
| TransfersService (1 address) | 40,320 | 4,032 | **90%** |
| WebSocket Service (1 client) | 28,800 | 7,200 | **75%** |
| Price Updater | 5,760 | 1,920 | **67%** |
| Frontend Refresh (1 user) | ~1,440 | ~480 | **67%** |
| **TOTAL** | **~76,320** | **~13,632** | **~82% reduction** |

---

## Additional Optimization Ideas

1. **Smart Chain Monitoring**
   - Only monitor chains where user has activity
   - Detect inactive chains and stop monitoring

2. **Cache-First Strategy**
   - Always check Redis cache before making API calls
   - Only call Alchemy if cache is expired

3. **Batch Requests**
   - Use Portfolio API batch endpoints when possible
   - Combine multiple requests into single API call

4. **WebSocket Priority**
   - Prefer WebSocket updates over polling
   - Only poll as fallback when WebSocket unavailable

5. **User Activity Detection**
   - Only poll when user is actively viewing the app
   - Pause polling when tab is inactive

6. **Compute Unit Budgeting**
   - Track compute units per user/session
   - Implement rate limiting per user
   - Alert when approaching limits

---

## Monitoring Recommendations

1. **Add Logging**
   - Log all Alchemy API calls with timestamps
   - Track compute units per endpoint
   - Monitor rate limit errors

2. **Add Metrics**
   - Track calls per hour/day
   - Track compute units consumed
   - Alert on unusual spikes

3. **Add Rate Limiting**
   - Implement per-user rate limits
   - Throttle requests when approaching limits
   - Queue requests instead of failing

---

## Quick Fix Script

Run this to see current compute unit consumption patterns:

```bash
# Check how many addresses are being monitored
grep -r "startMonitoring" app/server/src/

# Check current intervals
grep -r "setInterval\|setTimeout" app/server/src/services/ app/server/src/jobs/
```

---

## Next Steps

1. ✅ **Immediate**: Increase TransfersService interval to 5 minutes
2. ✅ **Immediate**: Increase WebSocket service intervals
3. ✅ **Short-term**: Optimize price updater interval
4. ✅ **Short-term**: Optimize frontend refresh intervals
5. ⏳ **Medium-term**: Implement smart chain monitoring
6. ⏳ **Medium-term**: Add compute unit tracking and alerts
