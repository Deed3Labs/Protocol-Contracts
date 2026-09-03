# Refresh Flow Diagram

## How `refreshAll()` Works

### 1. User Calls `refreshAll()` (from PortfolioContext)

```typescript
// PortfolioContext.tsx
const refreshAll = useCallback(async () => {
  await Promise.all([
    refreshBalances(),      // ← Calls useMultichainBalances.refresh()
    refreshHoldings(),       // ← Calls usePortfolioHoldings.refresh()
    refreshActivity(),       // ← Calls useMultichainActivity.refresh()
  ]);
}, [refreshBalances, refreshHoldings, refreshActivity]);
```

### 2. `refreshHoldings()` Calls `usePortfolioHoldings.refresh()`

```typescript
// PortfolioContext.tsx
const refreshHoldings = useCallback(async () => {
  await refreshHoldingsHook();  // ← This is usePortfolioHoldings.refresh()
}, [refreshHoldingsHook]);
```

### 3. `usePortfolioHoldings.refresh()` Calls NFT Hooks

```typescript
// usePortfolioHoldings.ts
const refresh = useCallback(async () => {
  const refreshPromises = [
    refreshAllBalances(),     // ← Native + ERC20 tokens
    refreshNFTs(),            // ← T-Deeds (useMultichainDeedNFTs.refresh())
  ];
  
  // Refresh general NFTs if we have contracts
  if (uniqueNFTContracts.length > 0) {
    refreshPromises.push(refreshGeneralNFTs());  // ← General NFTs (useGeneralNFTs.refresh())
  }
  
  await Promise.all(refreshPromises);
}, [refreshAllBalances, refreshNFTs, refreshGeneralNFTs, uniqueNFTContracts.length]);
```

## Complete Flow

```
User clicks "Refresh" button
  ↓
PortfolioContext.refreshAll()
  ↓
  ├─→ refreshBalances() → useMultichainBalances.refresh()
  │     └─→ Fetches native tokens + ERC20 tokens (via Alchemy API)
  │
  ├─→ refreshHoldings() → usePortfolioHoldings.refresh()
  │     ├─→ refreshAllBalances() → useMultichainBalances.refresh()
  │     ├─→ refreshNFTs() → useMultichainDeedNFTs.refresh()
  │     │     └─→ Fetches T-Deeds from all chains
  │     │
  │     └─→ refreshGeneralNFTs() → useGeneralNFTs.refresh()
  │           └─→ Fetches general NFTs from NFT_CONTRACTS config
  │
  └─→ refreshActivity() → useMultichainActivity.refresh()
        └─→ Fetches transaction history
```

## Initial Load

```typescript
// PortfolioContext.tsx - Line 191-203
useEffect(() => {
  if (!isConnected) return;
  
  // Initial load - refresh all data
  const initialRefresh = async () => {
    if (isMounted) {
      await refreshAll();  // ← Automatically called on wallet connect
    }
  };
  initialRefresh();
  
  // ... hourly auto-refresh setup
}, [isConnected]);
```

## Key Files

1. **`PortfolioContext.tsx`** - Main orchestrator
   - Provides `refreshAll()`, `refreshHoldings()`, `refreshBalances()`, `refreshActivity()`
   - Calls initial refresh on wallet connect

2. **`usePortfolioHoldings.ts`** - Holdings manager
   - Combines tokens + NFTs into unified holdings
   - Calls `refreshNFTs()` and `refreshGeneralNFTs()`

3. **`useMultichainDeedNFTs.ts`** - T-Deed fetcher
   - Fetches T-Deeds across all chains
   - Only fetches when `refresh()` is explicitly called

4. **`useGeneralNFTs.ts`** - General NFT fetcher
   - Fetches general NFTs from NFT_CONTRACTS config
   - Only fetches when `refresh()` is explicitly called

## Important Notes

- **No auto-fetch**: NFT hooks don't auto-fetch on mount (to avoid duplicate requests)
- **Manual refresh only**: NFTs only load when `refreshAll()` or `refreshHoldings()` is called
- **Initial load**: Happens automatically when wallet connects (via PortfolioContext useEffect)
