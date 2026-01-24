# NFT Price Caching & Frontend Hooks Analysis

## Current Status

### ✅ NFT Price Caching (Partially Implemented)

**Current Implementation:**
- NFT prices are **included in the NFT data cache**
- Cache key: `nft_list:{chainId}:{address}` (10 min TTL)
- Prices are fetched during NFT enumeration in `nftService.ts`
- Prices are stored as part of the NFT object (`priceUSD` field)

**Comparison with Token Prices:**
- Token prices: **Separate cache** with key `price:{chainId}:{tokenAddress}` (5 min TTL)
- NFT prices: **Included in NFT cache** (10 min TTL)

**Issue:**
- NFT prices are cached, but as part of NFT data
- If you want to update prices more frequently than NFT data, you'd need separate caching
- Currently, prices refresh when NFT cache expires (10 minutes)

### ❌ Frontend Hooks (Not Fully Set Up)

**Current State:**
1. **`useMultichainDeedNFTs.ts`** ✅ - Only handles T-Deeds (protocol contracts)
2. **General NFTs** ❌ - No hook exists to fetch general ERC721/ERC1155 NFTs
3. **`usePortfolioHoldings.ts`** ⚠️ - Only includes T-Deeds, missing general NFTs
4. **`PortfolioContext.tsx`** ⚠️ - Uses `usePortfolioHoldings`, so also missing general NFTs

**What's Missing:**
- Hook to fetch general NFTs from arbitrary contracts
- Integration of general NFTs into portfolio holdings
- Support for ERC1155 `amount` field in frontend

---

## Recommendations

### Option 1: Keep Current Caching (Recommended for Now)

**Pros:**
- Simpler implementation
- Prices update when NFT data updates
- Less cache complexity

**Cons:**
- Can't update prices independently of NFT data
- 10 min TTL for prices (vs 5 min for tokens)

**Verdict:** ✅ **Keep as-is for now** - The current approach is reasonable. If you need more frequent price updates, implement Option 2.

### Option 2: Separate NFT Price Caching (Future Enhancement)

**Implementation:**
- Add cache key: `nft_price:{chainId}:{contractAddress}` (5 min TTL)
- Cache prices separately from NFT data
- Update prices independently

**When to implement:** If you need prices to update more frequently than NFT data.

---

## Frontend Hooks - Required Updates

### 1. Create `useGeneralNFTs` Hook (NEW)

**Purpose:** Fetch general ERC721/ERC1155 NFTs from arbitrary contracts

**Location:** `app/src/hooks/useGeneralNFTs.ts`

**Implementation needed:**
```typescript
export function useGeneralNFTs(
  contractAddresses: Array<{ chainId: number; contractAddress: string }>
): {
  nfts: GeneralNFT[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}
```

### 2. Update `usePortfolioHoldings` Hook

**Current:** Only includes T-Deeds (RWAs)

**Needed:** Include general NFTs from `useGeneralNFTs`

**Changes:**
- Add `useGeneralNFTs` hook call
- Map general NFTs to `UnifiedHolding` with `type: 'nft'`
- Include `standard: 'ERC721' | 'ERC1155'` and `amount` fields

### 3. Update `PortfolioContext`

**Current:** Uses `usePortfolioHoldings` which doesn't include general NFTs

**Needed:** No changes if `usePortfolioHoldings` is updated (it will automatically include general NFTs)

---

## Implementation Plan

### Phase 1: Separate NFT Price Caching (Optional)

**Files to update:**
- `app/server/src/services/priceService.ts` - Add NFT price caching
- `app/server/src/routes/nfts.ts` - Check price cache before fetching
- `app/server/src/config/redis.ts` - Add `nftPrice` cache key function

**Priority:** Low (current caching works fine)

### Phase 2: Frontend General NFT Support (Required)

**Files to create:**
- `app/src/hooks/useGeneralNFTs.ts` - New hook for general NFTs

**Files to update:**
- `app/src/hooks/usePortfolioHoldings.ts` - Add general NFT support
- `app/src/components/BrokerageHome.tsx` - Display general NFTs (already has placeholder)

**Priority:** High (general NFTs are not accessible in frontend)

---

## Current Data Flow

### T-Deeds (Working ✅)
```
Frontend
  ↓
useMultichainDeedNFTs()
  ↓
getNFTs(chainId, address, contractAddress) // T-Deed contract
  ↓
GET /api/nfts/:chainId/:address?contractAddress=...
  ↓
Server: getDeedNFTs() → OpenSea pricing → Cache (10 min)
  ↓
Returns NFTs with priceUSD
```

### General NFTs (Not Working ❌)
```
Frontend
  ↓
❌ No hook exists
  ↓
Server: getGeneralNFTs() ✅ (exists but not called)
  ↓
GET /api/nfts/:chainId/:address?contractAddress=...&type=general ✅ (exists)
```

**Issue:** Frontend has no way to call general NFT endpoint!

---

## Next Steps

1. **Create `useGeneralNFTs` hook** - Enable frontend to fetch general NFTs
2. **Update `usePortfolioHoldings`** - Include general NFTs in portfolio
3. **Test general NFT display** - Verify in `BrokerageHome.tsx`
4. **Optional: Separate price caching** - If needed for more frequent updates
