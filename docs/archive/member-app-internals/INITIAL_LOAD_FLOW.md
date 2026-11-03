# Initial Load Flow - All Assets Fetched Together

## ✅ Current Flow (After Fix)

### On App Mount / Wallet Connect:

```
PortfolioContext (useEffect on mount)
  ↓
refreshAll()
  ↓
Promise.all([
  refreshBalances(),        // 1. Native Tokens + ERC20 Tokens
  refreshHoldings(),        // 2. T-Deeds + General NFTs
  refreshActivity()         // 3. Transactions
])
```

### Detailed Breakdown:

#### 1. `refreshBalances()` → Native Tokens + ERC20 Tokens
```
refreshBalances()
  ↓
useMultichainBalances().refresh()
  ↓
Fetches in parallel:
  - Native token balances (ETH, POL, xDAI, etc.) across all chains
  - ERC20 token balances (USDC, USDT, DAI, etc.) across all chains
  - Token prices from server API
```

#### 2. `refreshHoldings()` → T-Deeds + General NFTs
```
refreshHoldings()
  ↓
usePortfolioHoldings().refresh()
  ↓
Promise.all([
  refreshAllBalances(),     // Native + ERC20 (same as above, but idempotent)
  refreshNFTs(),            // T-Deeds (DeedNFT protocol contracts)
  refreshGeneralNFTs()       // General NFTs (ERC721/ERC1155) - if contracts provided
])
```

#### 3. `refreshActivity()` → Transactions
```
refreshActivity()
  ↓
useMultichainActivity().refresh()
  ↓
Fetches recent transactions across all chains
```

---

## 📊 What Gets Fetched on Initial Load

### ✅ Native Tokens
- **Source**: `useMultichainBalances()`
- **Chains**: All supported chains (Ethereum, Base, Polygon, Gnosis, Arbitrum, etc.)
- **Data**: Balance, USD value, currency symbol/name
- **Triggered by**: `refreshBalances()` in `PortfolioContext`

### ✅ ERC20 Tokens
- **Source**: `useMultichainBalances()`
- **Chains**: All supported chains
- **Tokens**: USDC, USDT, DAI, WETH, etc. (common tokens per chain)
- **Data**: Balance, USD value, symbol, name, decimals
- **Triggered by**: `refreshBalances()` in `PortfolioContext`

### ✅ T-Deeds (RWAs)
- **Source**: `useMultichainDeedNFTs()`
- **Chains**: All chains with DeedNFT contracts deployed
- **Data**: TokenId, definition, configuration, assetType, priceUSD, etc.
- **Triggered by**: `refreshHoldings()` → `usePortfolioHoldings().refresh()` → `refreshNFTs()`

### ✅ General NFTs (ERC721/ERC1155)
- **Source**: `useGeneralNFTs()`
- **Chains**: Specified in `generalNFTContracts` parameter
- **Data**: TokenId, contractAddress, uri, name, symbol, priceUSD, standard, amount
- **Triggered by**: `refreshHoldings()` → `usePortfolioHoldings().refresh()` → `refreshGeneralNFTs()`
- **Note**: Only fetched if `generalNFTContracts` array is provided to `usePortfolioHoldings()`

---

## 🔄 Refresh Flow

### Manual Refresh
```typescript
// From PortfolioContext
const { refreshAll } = usePortfolio();

// Refreshes everything:
await refreshAll();
// → refreshBalances() (Native + ERC20)
// → refreshHoldings() (T-Deeds + General NFTs)
// → refreshActivity() (Transactions)
```

### Individual Refresh
```typescript
const { refreshBalances, refreshHoldings, refreshActivity } = usePortfolio();

// Refresh specific section
await refreshBalances();   // Only Native + ERC20
await refreshHoldings();   // Only T-Deeds + General NFTs
await refreshActivity();   // Only Transactions
```

---

## ⚠️ Note: Potential Duplicate Call

**Current Implementation:**
- `refreshBalances()` calls `useMultichainBalances().refresh()`
- `refreshHoldings()` → `usePortfolioHoldings().refresh()` also calls `refreshAllBalances()` which calls `useMultichainBalances().refresh()`

**Impact:**
- Both calls happen in `Promise.all()`, so they run in parallel
- React hooks handle this gracefully (second call may be a no-op if first is in progress)
- **No breaking issue**, but slightly redundant

**Optimization (Optional):**
- Could remove `refreshAllBalances()` from `usePortfolioHoldings().refresh()` since `refreshBalances()` already handles it
- But current implementation works fine and ensures data consistency

---

## ✅ Summary

**On Initial Load, ALL of these are fetched together:**
1. ✅ **Native Tokens** (ETH, POL, xDAI, etc.) - via `refreshBalances()`
2. ✅ **ERC20 Tokens** (USDC, USDT, DAI, etc.) - via `refreshBalances()`
3. ✅ **T-Deeds** (RWAs) - via `refreshHoldings()`
4. ✅ **General NFTs** (ERC721/ERC1155) - via `refreshHoldings()` (if contracts provided)
5. ✅ **Transactions** - via `refreshActivity()`

**All triggered by:** `PortfolioContext.refreshAll()` on mount

**No duplicate auto-fetching:** Removed `useEffect` auto-fetch from individual hooks to prevent resource exhaustion.
