# Refresh System Analysis

## Executive Summary

The refresh system is **functional but not optimal** for real-time data updates. It uses a **pull-based architecture** (REST API polling) with no push mechanisms. Data updates are **infrequent** (hourly auto-refresh) and rely heavily on manual user actions.

## Current Architecture

### Data Flow

```
Frontend (React)
  ↓ HTTP Request
Server (Express)
  ↓ Check Redis Cache
  ├─→ Cache Hit → Return Cached Data
  └─→ Cache Miss → Fetch from Blockchain → Cache → Return Data
  ↓ HTTP Response
Frontend State Update (React Context/Hooks)
  ↓
UI Re-render
```

### Refresh Mechanisms

#### 1. **Manual Refresh**
- **Pull-to-Refresh**: Touch gesture on mobile (disabled on desktop)
- **Location**: `app/src/components/ui/PullToRefresh.tsx`
- **Trigger**: User pulls down from top of page
- **Action**: Calls `PortfolioContext.refreshAll()`
- **Frequency**: On-demand only

#### 2. **Auto-Refresh**
- **Location**: `app/src/context/PortfolioContext.tsx` (lines 190-225)
- **Frequency**: **Every 1 hour** after initial load
- **Initial Load**: Triggers immediately on wallet connect
- **Delay**: 1 minute delay before setting up hourly interval

```typescript
// Auto-refresh every hour
setInterval(() => {
  refreshAll();
}, 60 * 60 * 1000); // 1 hour
```

#### 3. **Initial Load**
- **Trigger**: When wallet connects (`isConnected` becomes `true`)
- **Action**: Calls `refreshAll()` once
- **Location**: `PortfolioContext.tsx` useEffect hook

### Server-Side Updates

#### Price Updater Job
- **Location**: `app/server/src/jobs/priceUpdater.ts`
- **Frequency**: **Every 5 minutes** (cron: `*/5 * * * *`)
- **Tokens Updated**: Popular tokens only (WETH, USDC on Ethereum & Base)
- **Method**: Background cron job updates Redis cache

#### Redis Caching TTLs
- **Balances**: 10 seconds (`CACHE_TTL_BALANCE`)
- **NFTs**: 600 seconds (10 minutes) (`CACHE_TTL_NFT`)
- **Prices**: 300 seconds (5 minutes) (`CACHE_TTL_PRICE`)
- **Transactions**: Not explicitly set (likely uses default)

## How New Data Updates the UI

### Current Process

1. **User Action or Timer** triggers refresh
2. **Frontend** calls `refreshAll()` from `PortfolioContext`
3. **Parallel API Calls** to server:
   - `refreshBalances()` → `/api/balances/batch`
   - `refreshHoldings()` → `/api/nfts/batch` + token balances
   - `refreshActivity()` → `/api/transactions/batch`
4. **Server** checks Redis cache first
5. **If cached**: Returns immediately
6. **If not cached**: Fetches from blockchain, caches, returns
7. **Frontend** receives data and updates React state
8. **UI re-renders** with new data

### State Management

- **PortfolioContext**: Central state for balances, holdings, transactions
- **Hooks**: `useMultichainBalances`, `usePortfolioHoldings`, `useMultichainActivity`
- **Data Preservation**: Previous data is preserved during refresh to prevent UI flashing

## Issues & Inefficiencies

### ❌ **No Real-Time Push Mechanism**

**Problem**: The system has **no WebSocket or Server-Sent Events (SSE)** implementation.

**Impact**:
- Users must manually refresh or wait up to 1 hour for updates
- No instant updates after transactions
- No live price updates
- Poor UX for time-sensitive data

**Evidence**: 
- No WebSocket/SSE code found in codebase
- All communication is HTTP REST API only

### ⚠️ **Infrequent Auto-Refresh**

**Problem**: Auto-refresh runs only **once per hour**.

**Impact**:
- Balance changes may not appear for up to 1 hour
- Transaction history updates slowly
- NFT mints/transfers not reflected immediately

**Recommendation**: Consider shorter intervals (5-15 minutes) or event-driven refresh

### ⚠️ **Cache TTL Mismatch**

**Problem**: Balance cache TTL (10s) is much shorter than auto-refresh interval (1 hour).

**Impact**:
- Cache expires quickly but frontend doesn't re-fetch
- Users see stale data even though cache is fresh
- Inefficient: Cache refreshes but UI doesn't

### ⚠️ **No Optimistic Updates**

**Problem**: After user transactions, UI doesn't immediately update.

**Impact**:
- User must manually refresh to see transaction results
- Poor UX after completing actions

### ⚠️ **No Event-Driven Refresh**

**Problem**: No listeners for blockchain events or transaction confirmations.

**Impact**:
- No automatic refresh after transaction completion
- No real-time updates for NFT mints, transfers, etc.

### ⚠️ **Limited Price Updates**

**Problem**: Price updater only updates 4 popular tokens every 5 minutes.

**Impact**:
- Other tokens may have stale prices
- No real-time price feeds for all tokens

## Recommendations

### 🔧 **High Priority**

1. **Implement WebSocket/SSE for Real-Time Updates**
   - Push price updates to connected clients
   - Notify clients of new transactions
   - Update balances in real-time

2. **Add Event-Driven Refresh**
   - Listen for transaction confirmations
   - Auto-refresh after user actions complete
   - Subscribe to blockchain events

3. **Optimistic Updates**
   - Update UI immediately after transactions
   - Show pending state, then confirm with real data

### 🔧 **Medium Priority**

4. **Reduce Auto-Refresh Interval**
   - Change from 1 hour to 5-15 minutes
   - Or make it adaptive based on user activity

5. **Improve Cache Strategy**
   - Align cache TTLs with refresh intervals
   - Implement cache invalidation on updates
   - Use cache headers for client-side caching

6. **Expand Price Updater**
   - Update all tokens, not just popular ones
   - Use WebSocket feeds from price providers

### 🔧 **Low Priority**

7. **Add Background Sync**
   - Use Service Workers for offline support
   - Queue updates when offline, sync when online

8. **Smart Refresh**
   - Only refresh visible data
   - Debounce rapid refresh requests
   - Prioritize critical data (balances over NFTs)

## Current Refresh Flow Diagram

```
┌─────────────────┐
│  User Action    │
│  (Pull/Button)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ PortfolioContext│
│  refreshAll()   │
└────────┬────────┘
         │
         ├─→ refreshBalances() ──→ API: /api/balances/batch
         ├─→ refreshHoldings() ───→ API: /api/nfts/batch
         └─→ refreshActivity() ───→ API: /api/transactions/batch
         │
         ▼
┌─────────────────┐
│  Server (Express)│
│  Check Redis    │
└────────┬────────┘
         │
         ├─→ Cache Hit → Return Cached
         └─→ Cache Miss → Fetch Blockchain → Cache → Return
         │
         ▼
┌─────────────────┐
│  React State    │
│  Update         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  UI Re-render   │
└─────────────────┘
```

## Server Push Architecture (Missing)

Currently, there is **no server push mechanism**. Here's what it should look like:

```
┌─────────────────┐
│  Server Events  │
│  (Blockchain)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Event Listener │
│  (Server)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  WebSocket/SSE  │
│  Push to Client │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Frontend       │
│  Auto-Update UI │
└─────────────────┘
```

## Conclusion

The refresh system is **functional but not seamless**. It works for basic use cases but lacks real-time capabilities. The system is:

- ✅ **Properly structured**: Clean separation of concerns
- ✅ **Efficient caching**: Redis reduces blockchain calls
- ⚠️ **Not real-time**: No push mechanisms
- ⚠️ **Infrequent updates**: 1-hour refresh interval
- ⚠️ **Manual-heavy**: Relies on user-initiated refreshes

**Overall Rating: 6/10** - Works but needs real-time capabilities for production-grade UX.
