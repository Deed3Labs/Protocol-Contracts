# Hooks Comparison: useMultichainBalances vs useMultichainDeedNFTs vs usePortfolioHoldings

## Overview

These three hooks serve different purposes in the portfolio system. Here's how they differ:

## 1. `useMultichainBalances` - Token Balances Only

**Purpose**: Fetches **token balances** (native tokens + ERC20 tokens) across all chains.

**What it fetches**:
- ✅ Native token balances (ETH, BASE, POL, xDAI, etc.) - one per chain
- ✅ ERC20 token balances (USDC, USDT, DAI, WETH, etc.) - multiple per chain
- ❌ NFTs/T-Deeds

**Data structure**:
```typescript
{
  balances: MultichainBalance[];      // Native tokens (ETH, POL, etc.)
  tokens: MultichainTokenBalance[];    // ERC20 tokens (USDC, USDT, etc.)
  totalBalance: string;                // Sum of native balances
  totalBalanceUSD: number;            // USD value of native balances
  totalTokenValueUSD: number;         // USD value of ERC20 tokens
  totalValueUSD: number;              // Combined total
  refresh: () => Promise<void>;       // Refreshes both native + ERC20
  refreshBalances: () => Promise<void>; // Only native tokens
  refreshTokens: () => Promise<void>;   // Only ERC20 tokens
}
```

**Server endpoints used**:
- `/api/balances/:chainId/:address` - Native token balances
- `/api/token-balances/batch` - ERC20 token balances (batch)

**Auto-refresh**: ✅ Yes - automatically fetches on mount when `address` is available

**Key features**:
- Fetches prices for all tokens
- Calculates USD values
- Handles both native and ERC20 tokens
- Uses batch API for efficiency

---

## 2. `useMultichainDeedNFTs` - NFTs Only

**Purpose**: Fetches **T-Deed NFTs** across all chains.

**What it fetches**:
- ✅ T-Deed NFTs (DeedNFT tokens) - multiple per chain
- ❌ Token balances

**Data structure**:
```typescript
{
  nfts: MultichainDeedNFT[];          // Array of NFT objects
  totalCount: number;                 // Total number of NFTs
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;       // Refreshes all NFTs
  refreshChain: (chainId) => Promise<void>; // Refreshes one chain
}
```

**Server endpoints used**:
- `/api/nfts/:chainId/:address?contractAddress=...` - NFT list

**Auto-refresh**: ❌ **NO** - Does NOT auto-fetch on mount
- Line 138-140: "Automatic refresh is now controlled by PortfolioContext"
- Only provides `refresh()` function that must be called manually
- Relies on parent component/context to call `refresh()`

**Key features**:
- Fetches NFTs from DeedNFT contract
- Filters by owner address
- Includes metadata (definition, configuration, assetType)
- Uses device-optimized fetching (sequential for mobile, parallel for desktop)

---

## 3. `usePortfolioHoldings` - Unified Portfolio (Tokens + NFTs)

**Purpose**: **Composition hook** that combines tokens AND NFTs into a unified format.

**What it does**:
- ✅ Uses `useMultichainBalances()` internally (gets tokens)
- ✅ Uses `useMultichainDeedNFTs()` internally (gets NFTs)
- ✅ Combines both into unified `UnifiedHolding[]` format
- ✅ Calculates cash balance from stablecoins
- ✅ Calculates total portfolio value

**Data structure**:
```typescript
{
  holdings: UnifiedHolding[];         // Combined tokens + NFTs
  cashBalance: {
    totalCash: number;                 // All stablecoins
    usdcBalance: number;               // USDC only
    otherStablecoinsBalance: number;   // Other stablecoins
  };
  totalValueUSD: number;               // Total portfolio value
  isLoading: boolean;                  // Combined loading state
  refresh: () => Promise<void>;        // Refreshes both tokens + NFTs
}
```

**UnifiedHolding format**:
```typescript
{
  id: string;              // "{chainId}-nft-{tokenId}" or "{chainId}-token-{address}"
  type: 'nft' | 'token';
  asset_name: string;
  asset_symbol: string;    // "T-Deed" for NFTs
  balanceUSD: number;       // 0 for NFTs
  chainId: number;
  chainName: string;
  // ... other properties
}
```

**Server endpoints**: None directly - uses the other two hooks

**Auto-refresh**: ✅ Yes - automatically refreshes when underlying hooks refresh

**Key features**:
- **Unified format**: Both NFTs and tokens in same array
- **Cash balance calculation**: Automatically calculates from stablecoins
- **Sorting**: Sorts by USD value (descending), NFTs first if same value
- **Single source of truth**: One hook for all portfolio holdings

---

## Comparison Table

| Feature | useMultichainBalances | useMultichainDeedNFTs | usePortfolioHoldings |
|---------|----------------------|----------------------|---------------------|
| **Fetches Native Tokens** | ✅ Yes | ❌ No | ✅ Yes (via useMultichainBalances) |
| **Fetches ERC20 Tokens** | ✅ Yes | ❌ No | ✅ Yes (via useMultichainBalances) |
| **Fetches NFTs** | ❌ No | ✅ Yes | ✅ Yes (via useMultichainDeedNFTs) |
| **Auto-refresh on mount** | ✅ Yes | ❌ No | ✅ Yes (inherits from child hooks) |
| **Calculates USD values** | ✅ Yes | ❌ No | ✅ Yes (inherits) |
| **Calculates cash balance** | ❌ No | ❌ No | ✅ Yes |
| **Unified format** | ❌ No | ❌ No | ✅ Yes |
| **Server API calls** | Direct | Direct | Indirect (via other hooks) |
| **Use case** | Token balances only | NFTs only | Complete portfolio view |

---

## Usage Patterns

### When to use `useMultichainBalances`:
```typescript
// When you only need token balances
const { balances, tokens, totalValueUSD } = useMultichainBalances();

// Display native balances
balances.forEach(b => console.log(`${b.chainName}: ${b.balance} ${b.currencySymbol}`));

// Display ERC20 tokens
tokens.forEach(t => console.log(`${t.symbol}: ${t.balance} ($${t.balanceUSD})`));
```

### When to use `useMultichainDeedNFTs`:
```typescript
// When you only need NFTs
const { nfts, totalCount, refresh } = useMultichainDeedNFTs();

// Must manually refresh (doesn't auto-fetch)
useEffect(() => {
  if (address) refresh();
}, [address, refresh]);

// Display NFTs
nfts.forEach(nft => console.log(`${nft.definition} (Token ID: ${nft.tokenId})`));
```

### When to use `usePortfolioHoldings`:
```typescript
// When you need everything in one place (most common)
const { holdings, cashBalance, totalValueUSD, refresh } = usePortfolioHoldings();

// Holdings includes both tokens AND NFTs
holdings.forEach(h => {
  if (h.type === 'nft') {
    console.log(`NFT: ${h.asset_name}`);
  } else {
    console.log(`Token: ${h.asset_symbol} - $${h.balanceUSD}`);
  }
});

// Cash balance is automatically calculated
console.log(`Cash: $${cashBalance.totalCash}`);
```

---

## Relationship Diagram

```
usePortfolioHoldings (Composition Hook)
  ├── useMultichainBalances (Token Hook)
  │     ├── Fetches native tokens
  │     └── Fetches ERC20 tokens
  │
  └── useMultichainDeedNFTs (NFT Hook)
        └── Fetches T-Deed NFTs

Result: Unified holdings array with tokens + NFTs
```

---

## Key Differences Summary

1. **Scope**:
   - `useMultichainBalances`: Tokens only
   - `useMultichainDeedNFTs`: NFTs only
   - `usePortfolioHoldings`: Everything (uses both hooks)

2. **Auto-refresh**:
   - `useMultichainBalances`: ✅ Auto-fetches
   - `useMultichainDeedNFTs`: ❌ Manual refresh only
   - `usePortfolioHoldings`: ✅ Auto-fetches (inherits from child hooks)

3. **Data format**:
   - `useMultichainBalances`: Separate arrays for native tokens and ERC20 tokens
   - `useMultichainDeedNFTs`: Array of NFT objects
   - `usePortfolioHoldings`: Unified array with both tokens and NFTs

4. **Additional features**:
   - `useMultichainBalances`: Price fetching, USD calculations
   - `useMultichainDeedNFTs`: Device-optimized fetching
   - `usePortfolioHoldings`: Cash balance calculation, unified sorting

---

## Current Issues

### Issue 1: NFTs don't auto-load
- `useMultichainDeedNFTs` doesn't auto-fetch on mount
- Relies on `PortfolioContext` to call `refreshNFTs()` on initial load
- If `PortfolioContext` doesn't call it, NFTs won't appear until manual refresh

### Issue 2: refreshBalances() doesn't refresh NFTs
- `useMultichainBalances.refreshBalances()` only refreshes tokens
- NFTs must be refreshed separately via `refreshNFTs()`
- `usePortfolioHoldings.refresh()` correctly refreshes both

---

## Best Practices

1. **For portfolio views**: Use `usePortfolioHoldings` - it provides everything in one place
2. **For token-only views**: Use `useMultichainBalances` - more granular control
3. **For NFT-only views**: Use `useMultichainDeedNFTs` - but remember to manually refresh
4. **Always refresh both**: When refreshing balances, also refresh NFTs via `usePortfolioHoldings.refresh()`
