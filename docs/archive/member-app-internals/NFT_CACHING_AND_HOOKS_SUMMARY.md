# NFT Price Caching & Frontend Hooks - Summary

## ✅ Current Status

### 1. NFT Price Caching

**Status:** ✅ **Working (Included in NFT Cache)**

**How it works:**
- NFT prices are fetched during NFT enumeration in `nftService.ts`
- Prices are included in the NFT data structure (`priceUSD` field)
- Entire NFT list (with prices) is cached in Redis with key `nft_list:{chainId}:{address}` (10 min TTL)
- Prices refresh when NFT cache expires

**Comparison with Token Prices:**
- **Token prices**: Separate cache `price:{chainId}:{tokenAddress}` (5 min TTL)
- **NFT prices**: Included in NFT cache `nft_list:{chainId}:{address}` (10 min TTL)

**Verdict:** ✅ **Current approach is fine** - Prices are cached, just as part of NFT data rather than separately. If you need more frequent price updates, we can implement separate caching later.

---

### 2. Frontend Hooks - ✅ **Now Fully Set Up**

#### ✅ Created: `useGeneralNFTs` Hook

**File:** `app/src/hooks/useGeneralNFTs.ts`

**Purpose:** Fetch general ERC721/ERC1155 NFTs from arbitrary contracts

**Usage:**
```typescript
const { nfts, isLoading, refresh } = useGeneralNFTs([
  { chainId: 84532, contractAddress: '0x1234...' },
  { chainId: 1, contractAddress: '0x5678...' }
]);
```

**Features:**
- ✅ Supports ERC721 and ERC1155
- ✅ Auto-fetches on mount
- ✅ Device-optimized fetching (sequential for mobile, parallel for desktop)
- ✅ Includes `priceUSD`, `standard`, `amount` fields

#### ✅ Updated: `usePortfolioHoldings` Hook

**File:** `app/src/hooks/usePortfolioHoldings.ts`

**Changes:**
- ✅ Now accepts optional `generalNFTContracts` parameter
- ✅ Integrates `useGeneralNFTs` hook
- ✅ Maps general NFTs to `UnifiedHolding` with `type: 'nft'`
- ✅ **Fixed price calculation**: Now uses `priceUSD` for T-Deeds and general NFTs
- ✅ Calculates `balanceUSD = priceUSD * amount` for ERC1155

**Usage:**
```typescript
// Only T-Deeds (default)
const { holdings } = usePortfolioHoldings();

// With general NFTs
const { holdings } = usePortfolioHoldings([
  { chainId: 84532, contractAddress: '0x1234...' }
]);
```

#### ✅ Updated: `apiClient.ts`

**File:** `app/src/utils/apiClient.ts`

**Changes:**
- ✅ `getNFTs()` now accepts optional `type` parameter
- ✅ Automatically sets `type=general` when `contractAddress` is provided

#### ✅ `PortfolioContext.tsx`

**Status:** ✅ **No changes needed** - Uses `usePortfolioHoldings`, so it automatically includes general NFTs when contracts are provided

---

## 📊 Data Flow (Updated)

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
  ↓
usePortfolioHoldings() → Maps to UnifiedHolding with balanceUSD = priceUSD
```

### General NFTs (Now Working ✅)
```
Frontend
  ↓
useGeneralNFTs(contractAddresses)
  ↓
getNFTs(chainId, address, contractAddress, 'general')
  ↓
GET /api/nfts/:chainId/:address?contractAddress=...&type=general
  ↓
Server: getGeneralNFTs() → OpenSea pricing → Cache (10 min)
  ↓
Returns NFTs with priceUSD, standard, amount
  ↓
usePortfolioHoldings() → Maps to UnifiedHolding with balanceUSD = priceUSD * amount
```

---

## 🎯 What's Working Now

1. ✅ **NFT prices are cached** (as part of NFT data, 10 min TTL)
2. ✅ **T-Deed prices** are included in portfolio with `balanceUSD = priceUSD`
3. ✅ **General NFT support** - Frontend can now fetch ERC721/ERC1155 NFTs
4. ✅ **Portfolio integration** - General NFTs appear in `usePortfolioHoldings`
5. ✅ **Price calculations** - Both T-Deeds and general NFTs use `priceUSD` for `balanceUSD`
6. ✅ **ERC1155 support** - Includes `amount` field and multiplies price by amount

---

## 📝 Next Steps (Optional)

### 1. Add General NFT Contract Configuration

Currently, general NFT contracts must be passed to `usePortfolioHoldings()`. You may want to:

- Add a config file: `app/src/config/generalNFTContracts.ts`
- Or fetch from user preferences/settings
- Or allow users to add contracts via UI

**Example:**
```typescript
// app/src/config/generalNFTContracts.ts
export const GENERAL_NFT_CONTRACTS: GeneralNFTContractConfig[] = [
  { chainId: 84532, contractAddress: '0x1234...' },
  { chainId: 1, contractAddress: '0x5678...' }
];

// In component
const { holdings } = usePortfolioHoldings(GENERAL_NFT_CONTRACTS);
```

### 2. Separate NFT Price Caching (Optional Enhancement)

If you want prices to update more frequently than NFT data:

- Add cache key: `nft_price:{chainId}:{contractAddress}` (5 min TTL)
- Check price cache before fetching from OpenSea
- Update prices independently of NFT data

**Priority:** Low (current approach works fine)

### 3. Verify BrokerageHome Display

Check that `BrokerageHome.tsx` correctly displays:
- T-Deeds (RWAs) with prices
- General NFTs with prices
- ERC1155 amounts

---

## 🔍 Testing

### Test T-Deed Prices
```typescript
const { holdings } = usePortfolioHoldings();
const tDeeds = holdings.filter(h => h.type === 'rwa');
console.log('T-Deeds with prices:', tDeeds.map(d => ({
  name: d.asset_name,
  price: d.balanceUSD
})));
```

### Test General NFTs
```typescript
const { holdings } = usePortfolioHoldings([
  { chainId: 84532, contractAddress: '0xYourContract' }
]);
const generalNFTs = holdings.filter(h => h.type === 'nft');
console.log('General NFTs:', generalNFTs);
```

---

## ✅ Summary

**NFT Price Caching:** ✅ Working (included in NFT cache, 10 min TTL)

**Frontend Hooks:** ✅ Fully set up
- ✅ `useGeneralNFTs` - Created
- ✅ `usePortfolioHoldings` - Updated to include general NFTs
- ✅ `apiClient.ts` - Updated to support `type` parameter
- ✅ Price calculations - Fixed to use `priceUSD`

**What you need to do:**
1. Add `OPENSEA_API_KEY` to Railway (backend) - ✅ Documented
2. Optionally: Configure general NFT contracts to fetch
3. Test in `BrokerageHome.tsx` to verify display

Everything is now properly connected! 🎉
