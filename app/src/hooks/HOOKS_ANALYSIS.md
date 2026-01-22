# Hooks Analysis & Optimization Recommendations

## Executive Summary

**Current State: Functional but with significant code duplication and redundancy**

The hooks are **working** but have room for improvement. The code is **moderately messy** due to:
- Significant code duplication across hooks
- Redundant single-chain vs multichain hooks
- Repeated patterns that could be abstracted
- Inconsistent error handling approaches

**Overall Assessment: 6.5/10** - Functional but needs refactoring for maintainability

---

## Current Hook Structure

### Multichain Hooks (Primary)
1. `useMultichainBalances` - Native token balances across chains
2. `useMultichainTokenBalances` - ERC20 token balances across chains  
3. `useMultichainDeedNFTs` - NFTs across chains
4. `useMultichainActivity` - Transaction history across chains

### Single-Chain Hooks (Potentially Redundant)
5. `useTokenBalances` - Single-chain ERC20 balances
6. `useWalletBalance` - Single-chain native balance

### Utility Hooks
7. `usePricingData` - Token pricing (Uniswap/CoinGecko)

---

## Issues Identified

### 🔴 Critical Issues

#### 1. **Code Duplication (High Priority)**
- **Mobile detection** repeated in 4+ hooks:
  ```typescript
  const isMobileDevice = (): boolean => {
    if (typeof window === 'undefined') return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  };
  ```
- **Timeout pattern** repeated:
  ```typescript
  await Promise.race([
    apiCall(),
    new Promise<null>((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), 3000)
    ),
  ])
  ```
- **Refresh logic** duplicated across all multichain hooks (mobile sequential vs desktop parallel)
- **Error handling** patterns repeated (silent errors, fallback logic)

#### 2. **Redundant Hooks**
- `useTokenBalances` vs `useMultichainTokenBalances` - Can use multichain version with chainId filter
- `useWalletBalance` vs `useMultichainBalances` - Can use multichain version with chainId filter
- Both single-chain hooks have auto-refresh intervals that multichain hooks don't have

#### 3. **COMMON_TOKENS Duplication**
- Defined in both `useTokenBalances.ts` and `useMultichainTokenBalances.ts`
- Should be in a shared config file

### 🟡 Medium Priority Issues

#### 4. **Inconsistent Patterns**
- Some hooks auto-refresh (`useTokenBalances`, `useWalletBalance`)
- Multichain hooks don't auto-refresh (controlled by `PortfolioContext`)
- Inconsistent loading state management

#### 5. **Provider Management**
- Mixed use of `getEthereumProvider()`, `getCachedProvider()`, and direct `JsonRpcProvider` creation
- Could be unified through a single provider utility

#### 6. **Error Handling Inconsistency**
- Some hooks log errors, others are silent
- Some hooks return empty arrays on error, others return error states
- Inconsistent error message formats

### 🟢 Low Priority Issues

#### 7. **Type Definitions**
- Similar interfaces could be consolidated
- Some types are exported, others aren't (inconsistent)

#### 8. **Documentation**
- Good: `HOOKS_COMPARISON.md` exists
- Missing: JSDoc comments in some hooks
- Missing: Usage examples in code

---

## Optimization Recommendations

### Priority 1: Extract Common Utilities

Create `hooks/utils/multichainHelpers.ts`:

```typescript
// Shared utilities for all multichain hooks
export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number = 3000
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    ),
  ]);
};

export const fetchSequentially = async <T>(
  items: any[],
  fetchFn: (item: any) => Promise<T[]>,
  delayMs: number = 300
): Promise<T[]> => {
  const results: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const itemResults = await fetchFn(items[i]);
    results.push(...itemResults);
    if (i < items.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return results;
};

export const fetchInParallel = async <T>(
  items: any[],
  fetchFn: (item: any) => Promise<T[]>
): Promise<T[]> => {
  const promises = items.map(item => fetchFn(item));
  const results = await Promise.all(promises);
  return results.flat();
};
```

### Priority 2: Create Base Multichain Hook

Create `hooks/useBaseMultichain.ts`:

```typescript
// Base hook that provides common multichain functionality
export function useBaseMultichain<T>(
  fetchChainData: (chainId: number) => Promise<T[]>,
  options?: {
    enabled?: boolean;
    onError?: (error: Error, chainId: number) => void;
  }
) {
  const { address, isConnected } = useAppKitAccount();
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshChain = useCallback(async (chainId: number) => {
    // Common refresh chain logic
  }, [fetchChainData, address, isConnected]);

  const refresh = useCallback(async () => {
    // Common refresh all logic with mobile/desktop handling
  }, [fetchChainData, address, isConnected]);

  return { data, isLoading, error, refresh, refreshChain };
}
```

### Priority 3: Consolidate Single-Chain Hooks

**Option A: Deprecate single-chain hooks**
- Update components to use multichain hooks with chainId filter
- Mark old hooks as deprecated

**Option B: Make single-chain hooks wrappers**
```typescript
export function useTokenBalances() {
  const { caipNetworkId } = useAppKitNetwork();
  const chainId = useMemo(() => 
    caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined,
    [caipNetworkId]
  );
  
  const { tokens, isLoading, error, refresh } = useMultichainTokenBalances();
  
  const filteredTokens = useMemo(() => 
    chainId ? tokens.filter(t => t.chainId === chainId) : tokens,
    [tokens, chainId]
  );
  
  return { tokens: filteredTokens, isLoading, error, refresh };
}
```

### Priority 4: Consolidate COMMON_TOKENS

Create `config/tokens.ts`:
```typescript
export const COMMON_TOKENS: Record<number, Array<{
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}>> = {
  // ... centralized token definitions
};
```

### Priority 5: Unified Error Handling

Create `hooks/utils/errorHandling.ts`:
```typescript
export const handleMultichainError = (
  error: unknown,
  chainId: number,
  chainName: string,
  silent: boolean = true
): { error: string | null; shouldLog: boolean } => {
  const errorMessage = error instanceof Error 
    ? error.message 
    : 'Unknown error';
  
  if (!silent) {
    console.error(`Error fetching data for ${chainName} (${chainId}):`, error);
  }
  
  return {
    error: errorMessage,
    shouldLog: !silent
  };
};
```

---

## Refactoring Plan

### Phase 1: Extract Utilities (Low Risk)
1. Create `hooks/utils/` directory
2. Move mobile detection, timeout, fetch helpers
3. Update all hooks to use shared utilities
4. **Estimated time: 2-3 hours**

### Phase 2: Consolidate Config (Low Risk)
1. Create `config/tokens.ts`
2. Move COMMON_TOKENS to shared config
3. Update hooks to import from config
4. **Estimated time: 1 hour**

### Phase 3: Create Base Hook (Medium Risk)
1. Create `useBaseMultichain` hook
2. Refactor one hook at a time to use base
3. Test thoroughly after each refactor
4. **Estimated time: 4-6 hours**

### Phase 4: Consolidate Single-Chain Hooks (Medium Risk)
1. Update components using `useTokenBalances` and `useWalletBalance`
2. Replace with multichain versions or wrappers
3. Remove old hooks
4. **Estimated time: 3-4 hours**

### Phase 5: Unified Error Handling (Low Risk)
1. Create error handling utilities
2. Update all hooks to use unified approach
3. **Estimated time: 2 hours**

**Total Estimated Time: 12-16 hours**

---

## Code Quality Metrics

### Current State
- **Lines of Code**: ~2,500+ across hooks
- **Duplication**: ~30-40% (estimated)
- **Test Coverage**: Unknown (no test files found)
- **Type Safety**: Good (TypeScript used throughout)

### After Refactoring (Projected)
- **Lines of Code**: ~1,800-2,000 (20-30% reduction)
- **Duplication**: ~5-10% (significant reduction)
- **Maintainability**: Much improved
- **Type Safety**: Maintained

---

## Migration Strategy

### For Existing Components
1. **No breaking changes** - Keep existing hook APIs
2. **Gradual migration** - Refactor hooks one at a time
3. **Backward compatibility** - Keep old hooks until all components migrated

### Testing Strategy
1. Test each hook individually after refactoring
2. Test PortfolioContext integration
3. Test mobile vs desktop behavior
4. Test error scenarios (server down, RPC failures)

---

## Conclusion

**The hooks are functional but need refactoring for:**
- ✅ Reduced code duplication
- ✅ Better maintainability
- ✅ Easier testing
- ✅ Consistent patterns

**Recommendation: Proceed with refactoring in phases, starting with low-risk utility extraction.**

---

## Quick Wins (Can be done immediately)

1. ✅ Extract `isMobileDevice()` to shared utility (5 min)
2. ✅ Extract `withTimeout()` helper (10 min)
3. ✅ Move `COMMON_TOKENS` to config file (15 min)
4. ✅ Add JSDoc comments to hooks (30 min)

**Total Quick Wins: ~1 hour for immediate improvements**
