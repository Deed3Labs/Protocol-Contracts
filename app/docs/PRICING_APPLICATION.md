# Pricing Data Application Summary

## Overview

This document explains how pricing data is applied to different token types across the application.

## Token Types & Pricing

### 1. ✅ Native Tokens (ETH, BASE, etc.)

**Hook**: `useMultichainBalances`

**Current Implementation**:
- Uses `usePricingData()` to get ETH price (fetches for current chain's native token)
- Applies same price to all native tokens across all chains
- **Formula**: `balanceUSD = balance * ethPrice`

**Code Location**: `app/src/hooks/useMultichainBalances.ts:68, 94, 114`

```typescript
// Get ETH price for USD conversion (using mainnet price as reference)
const { price: ethPrice } = usePricingData();

// Applied to each chain's native balance
const balanceUSD = parseFloat(balance) * (ethPrice || 0);
```

**Note**: All supported chains (Ethereum, Base, Sepolia, Base Sepolia) use ETH as their native token, so using a single ETH price is correct. However, the price is fetched for the **current chain** (based on `caipNetworkId`), not necessarily Ethereum mainnet.

**Recommendation**: Should fetch ETH price from Ethereum mainnet (chainId: 1) for consistency, regardless of current chain.

---

### 2. ✅ Stablecoins (USDC, USDT, DAI, etc.)

**Hook**: `useMultichainTokenBalances`

**Current Implementation**:
- Always uses **$1.00** price for stablecoins
- Has fallback to ensure $1 even if price fetch fails
- **Formula**: `balanceUSD = balance * 1.0`

**Code Location**: `app/src/hooks/useMultichainTokenBalances.ts:75-96, 143-150, 231-235`

```typescript
const getTokenPrice = useCallback(async (symbol: string, ...) => {
  // Stablecoins are always $1
  if (isStablecoin(symbol)) return 1.0;
  // ... other tokens
}, []);

// Double-check: if price is 0 but it's a stablecoin, force to $1
if (tokenPrice === 0 && isStablecoin(normalizedSymbol)) {
  tokenPrice = 1.0;
}

const balanceUSD = balanceNum * tokenPrice;
```

**Status**: ✅ **Correctly implemented** - Stablecoins always get $1 price

---

### 3. ✅ Other Tokens (WETH, etc.)

**Hook**: `useMultichainTokenBalances`

**Current Implementation**:
- Fetches price from multiple sources with fallback chain:
  1. Server API (with Redis caching)
  2. Uniswap V3 pools (primary on-chain source)
  3. CoinGecko API (fallback)
- **Formula**: `balanceUSD = balance * tokenPrice`

**Code Location**: `app/src/hooks/useMultichainTokenBalances.ts:75-96`

```typescript
const getTokenPrice = useCallback(async (symbol: string, address: string, ...) => {
  // Stablecoins handled separately
  if (isStablecoin(symbol)) return 1.0;
  
  // Try Uniswap first (primary source)
  try {
    const price = await getUniswapPrice(provider, address, chainId);
    if (price && price > 0 && isFinite(price)) return price;
  } catch (error) {
    // Continue to fallback
  }
  
  // Fallback to CoinGecko if Uniswap fails
  try {
    const price = await getCoinGeckoPrice(address, chainId);
    if (price && price > 0 && isFinite(price)) return price;
  } catch (error) {
    // Silent fallback - price will default to 0
  }
  
  return 0;
}, []);
```

**Status**: ✅ **Correctly implemented** - Fetches per-token prices from Uniswap/CoinGecko

---

## Issues Identified

### ⚠️ Issue 1: Native Token Price Source

**Problem**: `useMultichainBalances` uses `usePricingData()` which fetches price for the **current chain's** native token, not necessarily Ethereum mainnet.

**Impact**: 
- If user is on Base, it fetches BASE's native token price (which is ETH, so same)
- If user is on a testnet, it might fetch testnet prices (which may not exist)
- Should always fetch from Ethereum mainnet for consistency

**Recommendation**: Fetch ETH price from Ethereum mainnet (chainId: 1) specifically, regardless of current chain.

### ✅ Issue 2: Stablecoins - FIXED

**Status**: Already fixed in recent changes
- Stablecoins now always get $1 price
- Has double-check fallback to ensure $1 even if price fetch fails
- Symbol normalization ensures case-insensitive matching

---

## Summary Table

| Token Type | Hook | Price Source | Status |
|------------|------|--------------|--------|
| **Native Tokens** (ETH, BASE) | `useMultichainBalances` | `usePricingData()` (current chain) | ⚠️ Should use Ethereum mainnet |
| **Stablecoins** (USDC, USDT, DAI) | `useMultichainTokenBalances` | Hardcoded $1.00 | ✅ Correct |
| **Other Tokens** (WETH, etc.) | `useMultichainTokenBalances` | Uniswap → CoinGecko | ✅ Correct |

---

## Recommendations

1. **Fix Native Token Pricing**: Fetch ETH price from Ethereum mainnet (chainId: 1) specifically
2. **Add Price Caching**: Cache prices per chain to avoid redundant API calls
3. **Add Price Refresh**: Allow manual refresh of prices independent of balances
