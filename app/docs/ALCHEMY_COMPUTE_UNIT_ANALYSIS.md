# Alchemy Compute Unit Consumption Analysis

## Summary
You've consumed over 2M compute units since last night. This document identifies the main sources of high compute unit consumption.

## Implementation Status (Recommendations Applied)

| Recommendation | Status | Where |
|----------------|--------|--------|
| **EventListenerService**: Use WebSocket (eth_subscribe) for supported chains | ✅ Done | `app/server/src/services/eventListenerService.ts` – WebSocket for chains 1, 137, 42161, 8453 |
| **EventListenerService**: HTTP getLogs polling for other chains (no eth_getFilterChanges) | ✅ Done | Same file – getLogs every 2 min for chains 100, 11155111, 84532 |
| **RPC utils**: Alchemy WebSocket URL + supported chains | ✅ Done | `app/server/src/utils/rpc.ts` – `getAlchemyWebSocketUrl()`, `ALCHEMY_WEBSOCKET_SUPPORTED_CHAINS` |
| TransfersService interval | ✅ Already 10 min | `app/server/src/services/transfersService.ts` |
| WebSocket service intervals | ✅ Already optimized | Balances 5 min, transactions 10 min, NFTs 5 min, prices 5 min |
| Price updater | ✅ Already 15 min | `app/server/src/jobs/priceUpdater.ts` |
| Frontend PortfolioContext | ✅ Already optimized | 30 min / 60 min, page visibility |
| Smart chain monitoring | ✅ Done | TransfersService: subscribed chains only; inactive chains stopped after 10 checks |
| Compute unit tracking & alerts | ✅ Done | `computeUnitTracker`: hourly 24h summary; optional env `ALCHEMY_CU_ALERT_THRESHOLD`, `ALCHEMY_CU_DAILY_ALERT_THRESHOLD` |

## Major Compute Unit Consumers

### 🔴 **CRITICAL: TransfersService** ✅ Optimized

**Location**: `app/server/src/services/transfersService.ts`

**Current (optimized) behavior**:
- Checks transfers **every 10 minutes** per chain (not 30 seconds)
- **Smart chain monitoring**: Only monitors chains the user subscribed to (from WebSocket); stops monitoring a chain after 10 consecutive checks with no activity
- **Cache-first**: Skips API call if cache is &lt; 1 minute old
- Uses Alchemy Transfers API (`alchemy_getAssetTransfers`)

**Already applied**:
1. Interval set to 10 minutes (large reduction vs 30s)
2. Only monitors subscribed chains (websocketService passes `chainIds` from client)
3. Incremental block tracking and inactive-chain pruning in place
4. Cache debouncing in place

---

### 🟠 **HIGH: WebSocket Service Polling** ✅ Optimized

**Location**: `app/server/src/services/websocketService.ts`

**Current (optimized) intervals**:
1. **Balances**: Every **5 minutes**
2. **Transactions**: Every **10 minutes**
3. **NFTs**: Every **5 minutes**
4. **Prices**: Every **5 minutes**

**Already applied**: Only poll when clients are connected; cache used where applicable.

---

### 🟡 **MEDIUM: Price Updater Background Job** ✅ Optimized

**Location**: `app/server/src/jobs/priceUpdater.ts`

**Current (optimized) behavior**:
- Runs every **15 minutes** (not 5 minutes)
- Updates ~20 tokens across multiple chains via Alchemy Prices API
- Lower call volume than before

---

### 🟡 **MEDIUM: Frontend Auto-Refresh** ✅ Optimized

**Location**: `app/src/context/PortfolioContext.tsx`

**Current (optimized) behavior**:
- **No WebSocket**: refresh every **30 minutes**
- **WebSocket connected**: backup refresh every **60 minutes**
- **Page Visibility**: only refresh when tab is visible (`isPageVisible`)
- Relies on WebSocket updates when connected to reduce polling

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

## Immediate Action Items

All items below have been applied. See **Implementation Status** at the top and the **Current (optimized)** notes in each section.

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

## eth_blockNumber and eth_getFilterChanges (High CU Usage)

If Alchemy’s dashboard shows **eth_blockNumber** and **eth_getFilterChanges** as top methods, they are coming from these places:

### eth_getFilterChanges – main source: EventListenerService (server) ✅ MITIGATED

**Location**: `app/server/src/services/eventListenerService.ts`

**What it did**: Listened for DeedNFT `Transfer` events on **7 chains** using ethers `provider.on(filter, callback)` over HTTP, which used **eth_newFilter** + **eth_getFilterChanges** polled very frequently.

**What we did** (per [Alchemy Subscription API](https://www.alchemy.com/docs/reference/subscription-api) and [best practices](https://www.alchemy.com/docs/reference/best-practices-for-using-websockets-in-web3)):

1. **WebSocket (eth_subscribe) for 4 chains** where Alchemy supports it: Ethereum (1), Polygon (137), Arbitrum (42161), Base (8453). Uses `ethers.WebSocketProvider(wssUrl)` + `provider.on(filter, callback)` so ethers uses **eth_subscribe** ("logs") – no `eth_getFilterChanges` or `eth_blockNumber` polling.

2. **HTTP getLogs polling for the other 3 chains** (Gnosis 100, Sepolia 11155111, Base Sepolia 84532): no `provider.on(filter)`; instead a `setInterval` every **2 minutes** calls `provider.getLogs(fromBlock, toBlock, address, topics)` and processes logs. One **eth_getLogs** (+ optional **eth_blockNumber**) per chain per 2 min instead of many **eth_getFilterChanges** per minute.

3. **RPC helpers**: `app/server/src/utils/rpc.ts` now exports `getAlchemyWebSocketUrl(chainId)`, `ALCHEMY_WEBSOCKET_SUPPORTED_CHAINS`, and `isAlchemyWebSocketSupported(chainId)`.

**Further options** (if you need to reduce CUs more on the 3 HTTP chains):

- **Alchemy Notify / Webhooks** for `Transfer` on those contracts (no RPC polling).
- Increase `HTTP_GETLOGS_POLL_INTERVAL_MS` in `eventListenerService.ts` (e.g. 5 min).

### eth_blockNumber – likely sources

- **EventListenerService (server)**  
  Ethers’ filter-based event polling often uses the current block to decide when to poll, so the same service that drives `eth_getFilterChanges` can also trigger **eth_blockNumber** frequently (e.g. once per poll per chain).

- **Wagmi / Reown AppKit (frontend)**  
  If the app or AppKit uses block number (e.g. `useBlockNumber`, “current block” in the UI, or refetch-on-block), that will poll **eth_blockNumber** (often every few seconds). Your app code does not call `useBlockNumber` directly; if the dashboard shows lots of `eth_blockNumber` from the same Alchemy project as the app, check whether AppKit/Wagmi or any shared config enables block polling and increase the interval or disable it where not needed.

- **Other server code**  
  The rest of the server (e.g. `balanceService`) uses `getBalance` → **eth_getBalance**, not `getBlockNumber`. So **eth_blockNumber** is not expected from balance/portfolio fetches unless some other path explicitly calls block number.

### Summary table

| Source                         | Method(s)              | Where                         | Mitigation                                              |
|--------------------------------|-------------------------|-------------------------------|---------------------------------------------------------|
| EventListenerService (server) | eth_getFilterChanges   | `app/server/.../eventListenerService.ts` | Alchemy Notify / WebSocket / less frequent polling     |
| EventListenerService (server) | eth_blockNumber (tied to filter polling) | Same file                  | Same as above                                           |
| Wagmi / AppKit (frontend)     | eth_blockNumber        | Config / wallet UI           | Reduce or disable block polling if present              |

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

1. ✅ **Done**: EventListenerService – WebSocket for 4 chains, getLogs polling for 3 chains (no eth_getFilterChanges)
2. ✅ **Done**: TransfersService 10 min; WebSocket service and price updater optimized
3. ✅ **Done**: Frontend refresh 30/60 min and page visibility
4. ✅ **Done**: Smart chain monitoring – TransfersService uses subscribed chains only and stops inactive chains after 10 checks
5. ✅ **Done**: Compute unit tracking and alerts – `computeUnitTracker` logs hourly 24h summary; per-user and global alert thresholds (optional env `ALCHEMY_CU_ALERT_THRESHOLD`, `ALCHEMY_CU_DAILY_ALERT_THRESHOLD`)
6. ⏳ **Optional**: Alchemy Notify webhooks for the 3 HTTP chains to remove getLogs polling entirely
