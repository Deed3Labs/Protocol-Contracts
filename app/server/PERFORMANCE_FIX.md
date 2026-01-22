# Performance Fix: Pricing Data Loading Issues

## Problem

Pricing data for native tokens and stables wasn't loading properly on first load or refresh. Users had to manually refresh multiple times to get all data displayed correctly.

## Root Cause

1. **Race Conditions**: Every hook was calling `checkServerHealth()` individually on page load
2. **Sequential Delays**: Each health check had a 5-second timeout, causing cumulative delays
3. **Blocking Behavior**: Hooks waited for health check before trying API calls
4. **No Caching**: Health checks weren't cached, so multiple hooks all checked simultaneously

## Solution

### 1. Shared Health Check Manager (`serverHealth.ts`)

- **Deduplication**: Only one health check runs at a time
- **Caching**: Health status cached for 10 seconds
- **Faster Timeout**: Reduced from 5s to 3s
- **Non-blocking**: Hooks don't wait for health check

### 2. Direct API Calls with Timeout

All hooks now:
- **Skip health check**: Try server API directly
- **3-second timeout**: Fail fast if server is slow/unavailable
- **Quick fallback**: Immediately fall back to direct RPC/API calls
- **No blocking**: Don't wait for health check before trying API

### 3. Updated Hooks

All 7 hooks updated:
- ✅ `usePricingData` - Token prices
- ✅ `useMultichainBalances` - Native balances
- ✅ `useMultichainTokenBalances` - ERC20 token balances
- ✅ `useMultichainActivity` - Transactions
- ✅ `useMultichainDeedNFTs` - NFTs
- ✅ `useWalletBalance` - Single-chain native balance
- ✅ `useTokenBalances` - Single-chain token balances

## Benefits

1. **Faster Initial Load**: No waiting for health checks
2. **Better Resilience**: Quick fallback if server is down
3. **No Race Conditions**: Shared health check manager prevents conflicts
4. **Improved UX**: Data loads immediately on first page load

## Testing

After deploying:

1. **Clear browser cache** and reload page
2. **Check Network tab** - should see API calls immediately
3. **Verify data loads** on first load without manual refresh
4. **Check console** - should see fewer warnings/errors

## Expected Behavior

- ✅ Data loads on first page load
- ✅ No need for manual refresh
- ✅ Fast fallback if server is unavailable
- ✅ Consistent data display
