# T-Deed and NFT Holdings Data Flow

## Overview

This document explains how T-Deed NFTs and token holdings are fetched, processed, and displayed in the BrokerageHome component.

## Data Flow Architecture

### 1. **NFTs (T-Deeds) - Server-Side Only**

**Yes, NFTs are handled exclusively from the server**, just like tokens.

#### Fetch Flow:
```
BrokerageHome.tsx
  ↓
PortfolioContext (usePortfolio)
  ↓
usePortfolioHoldings()
  ↓
useMultichainDeedNFTs()
  ↓
getNFTs() [apiClient.ts]
  ↓
GET /api/nfts/:chainId/:address [Server Route]
  ↓
getDeedNFTs() [nftService.ts]
  ↓
Blockchain RPC calls (via ethers.js)
```

#### Key Files:
- **Client Hook**: `app/src/hooks/useMultichainDeedNFTs.ts`
  - Calls `getNFTs(chainId, address, contractAddress)` from `apiClient.ts`
  - Uses server API endpoint: `/api/nfts/:chainId/:address`
  - **Does NOT auto-refresh** - only provides `refresh()` function
  - Note: Line 139-140 says "Automatic refresh is now controlled by PortfolioContext"

- **Server Route**: `app/server/src/routes/nfts.ts`
  - Handles `/api/nfts/:chainId/:address` and `/api/nfts/batch`
  - Uses Redis caching (10 minute TTL by default)
  - Calls `getDeedNFTs()` from `nftService.ts`

- **Server Service**: `app/server/src/services/nftService.ts`
  - Fetches NFTs directly from blockchain using ethers.js
  - Queries `totalSupply()` and iterates through tokens
  - Filters by owner address
  - Returns array of `DeedNFTData`

### 2. **Tokens - Server-Side Only**

Tokens follow a similar server-side pattern:

```
BrokerageHome.tsx
  ↓
PortfolioContext (usePortfolio)
  ↓
usePortfolioHoldings()
  ↓
useMultichainBalances()
  ↓
getTokenBalancesBatch() [apiClient.ts]
  ↓
POST /api/token-balances/batch [Server Route]
  ↓
getTokenBalancesBatch() [balanceService.ts]
  ↓
Blockchain RPC calls (via ethers.js)
```

## The Problem: Why NFTs Don't Display / T-Deeds Only Appear After Manual Refresh

### Issue 1: NFTs Not Auto-Loading

**Root Cause**: `useMultichainDeedNFTs()` hook does NOT automatically fetch on mount.

Looking at `app/src/hooks/useMultichainDeedNFTs.ts`:
- Lines 138-140: "Note: Automatic refresh is now controlled by PortfolioContext"
- The hook only provides `refresh()` function but doesn't call it automatically
- It relies on `PortfolioContext` to call `refreshNFTs()` on initial load

**Current Flow in PortfolioContext** (`app/src/context/PortfolioContext.tsx`):
- Line 194-198: `refreshAll()` is called on initial load
- Line 173-179: `refreshAll()` calls:
  - `refreshBalances()` ✅
  - `refreshHoldings()` ✅ (which includes `refreshNFTs()`)
  - `refreshActivity()` ✅

**However**, `refreshHoldings()` calls `refreshHoldingsHook()` from `usePortfolioHoldings()`, which should call `refreshNFTs()`. Let me verify this works correctly...

### Issue 2: T-Deeds Only Appear After Manual refreshAll

**Root Cause**: The initial auto-refresh in `PortfolioContext` might be happening before the wallet is fully connected, or there's a timing issue.

Looking at `PortfolioContext.tsx`:
- Line 191-208: Auto-refresh runs when `isConnected` changes
- But `useMultichainDeedNFTs()` requires both `isConnected` AND `address` to be set
- There might be a race condition where `isConnected` is true but `address` isn't set yet

## Current Refresh Behavior

### Manual Refresh (Works):
```typescript
// In BrokerageHome.tsx
refreshAll() // Line 209, 752
  ↓
PortfolioContext.refreshAll() // Line 173-179
  ↓
Promise.all([
  refreshBalances(),    // ✅ Refreshes tokens
  refreshHoldings(),    // ✅ Refreshes tokens + NFTs
  refreshActivity()
])
  ↓
usePortfolioHoldings().refresh() // Line 148-154
  ↓
Promise.all([
  refreshAllBalances(), // ✅ Refreshes native + ERC20 tokens
  refreshNFTs()         // ✅ Refreshes NFTs
])
```

### Auto-Refresh on Initial Load (Might Not Work):
```typescript
// In PortfolioContext.tsx
useEffect(() => {
  if (!isConnected) return;
  
  const initialRefresh = async () => {
    await refreshAll(); // Line 196
  };
  initialRefresh();
}, [isConnected, refreshAll]);
```

**Problem**: `refreshAll` dependency might cause issues, and `address` might not be ready when `isConnected` becomes true.

## Solution Recommendations

### Fix 1: Ensure NFTs Load on Initial Mount

**Option A**: Make `useMultichainDeedNFTs()` auto-fetch on mount (like `useMultichainBalances` does)

**Option B**: Ensure `PortfolioContext` waits for both `isConnected` AND `address` before initial refresh

**Option C**: Add explicit initial fetch in `useMultichainDeedNFTs()` when `address` becomes available

### Fix 2: Ensure refreshNFTs is Called with refreshBalances

Currently, `refreshBalances()` in `PortfolioContext` only calls `refreshBalancesHook()`, which doesn't refresh NFTs.

**Problem**: When token balances are refreshed (e.g., from `tokenBalances.ts` route), NFTs are NOT refreshed.

**Solution**: Either:
1. Make `refreshBalances()` also refresh NFTs
2. Or ensure `refreshHoldings()` is called whenever balances are refreshed

## Data Structure

### NFT Data (from server):
```typescript
interface DeedNFTData {
  tokenId: string;
  owner: string;
  definition: string;
  configuration: string;
  assetType: number;
  // ... other properties
}

// Extended in useMultichainDeedNFTs:
interface MultichainDeedNFT extends DeedNFTData {
  chainId: number;
  chainName: string;
}
```

### Unified Holdings (in usePortfolioHoldings):
```typescript
interface UnifiedHolding {
  id: string; // Format: "{chainId}-nft-{tokenId}" for NFTs
  type: 'nft' | 'token';
  asset_name: string;
  asset_symbol: string; // "T-Deed" for NFTs
  balanceUSD: number; // 0 for NFTs
  chainId: number;
  chainName: string;
  tokenId?: string; // For NFTs
  // ... other properties
}
```

## Display in BrokerageHome.tsx

### Filtering (Line 235, 270-271):
```typescript
const [portfolioFilter, setPortfolioFilter] = useState<'All' | 'NFTs' | 'Tokens'>('All');

// Filter holdings by type
if (portfolioFilter === 'NFTs') {
  holdings = holdings.filter(h => h.type === 'nft');
}
```

### Display (Line 627-671):
```typescript
// Extract NFTs from displayed holdings
const nftHoldingsWithDeeds = displayedHoldings
  .filter(h => h.type === 'nft')
  .map(holding => {
    // Extract tokenId and chainId from holding.id
    // Find full deed data from portfolioHoldings
    // Return { holding, deed } for NFTHoldingItem component
  });

// Render NFTs
{nftHoldingsWithDeeds.map(({ holding, deed }) => (
  <NFTHoldingItem key={holding.id} holding={holding} deed={deed} />
))}
```

## Summary

1. **NFTs ARE handled exclusively from the server** (just like tokens)
2. **NFTs use `/api/nfts/:chainId/:address` endpoint** (similar to `/api/token-balances/:chainId/:address`)
3. **Problem**: NFTs don't auto-load on initial mount because:
   - `useMultichainDeedNFTs()` doesn't auto-fetch
   - Relies on `PortfolioContext` to call `refreshNFTs()` on initial load
   - There might be a timing issue with `address` not being ready
4. **Problem**: T-Deeds only appear after manual `refreshAll()` because:
   - `refreshBalances()` doesn't refresh NFTs
   - Only `refreshHoldings()` refreshes NFTs
   - Initial auto-refresh might not be calling `refreshHoldings()` properly

## Recommended Fixes

1. **Add auto-fetch to `useMultichainDeedNFTs()`** when `address` becomes available
2. **Ensure `PortfolioContext` initial refresh waits for `address`** (not just `isConnected`)
3. **Consider making `refreshBalances()` also refresh NFTs** (or ensure they're always refreshed together)
