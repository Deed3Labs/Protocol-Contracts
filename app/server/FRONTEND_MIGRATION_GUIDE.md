# Frontend Migration Guide - Portfolio API

## Overview

This guide explains how to migrate the frontend to use Alchemy's Portfolio API for more efficient multi-chain queries.

## Current State

### Backend Endpoints

**Old Endpoints (Still Available):**
- `GET /api/token-balances/all/:chainId/:userAddress` - Single chain tokens
- `POST /api/token-balances/all/batch` - Batch tokens (one request per chain)
- `GET /api/nfts/:chainId/:address` - Single chain NFTs
- `POST /api/nfts/batch` - Batch NFTs (one request per chain)

**New Portfolio API Endpoints:**
- `POST /api/token-balances/portfolio` - Multi-chain tokens (Portfolio API format)
- `POST /api/nfts/portfolio` - Multi-chain NFTs (Portfolio API format)

### Frontend Current Usage

**apiClient.ts:**
- `getAllTokenBalances()` - Uses old endpoint (single chain)
- `getAllTokenBalancesBatch()` - Uses old endpoint (batch, but one request per chain)
- `getNFTs()` - Uses old endpoint (single chain)
- `getNFTsBatch()` - Uses old endpoint (batch, but one request per chain)

**Hooks:**
- `useMultichainBalances` - Fetches tokens chain-by-chain
- `useGeneralNFTs` - Fetches NFTs chain-by-chain

## Migration Strategy

### Phase 1: Add Portfolio API Functions ✅

**Status:** COMPLETED

Added to `apiClient.ts`:
- `getTokensByAddressPortfolio()` - Multi-chain tokens via Portfolio API
- `getNFTsByAddressPortfolio()` - Multi-chain NFTs via Portfolio API

### Phase 2: Update Hooks (Recommended)

**Status:** PENDING

Update hooks to use Portfolio API when fetching multiple chains:

1. **useMultichainBalances**
   - Use `getTokensByAddressPortfolio()` when fetching multiple chains
   - Keep old method as fallback for single-chain queries
   - Benefits: Single request instead of N requests (one per chain)

2. **useGeneralNFTs**
   - Use `getNFTsByAddressPortfolio()` when fetching multiple chains
   - Keep old method as fallback for single-chain queries
   - Benefits: Single request instead of N requests (one per chain)

### Phase 3: Data Format Migration

**Portfolio API Format vs Old Format:**

**Tokens:**
```typescript
// Old Format
{
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceRaw: string;
}

// Portfolio API Format (Richer!)
{
  address: string;
  network: string;
  tokenAddress: string | null; // null for native tokens
  tokenBalance: string;
  tokenMetadata: {
    decimals: number;
    logo?: string;        // NEW!
    name?: string;
    symbol?: string;
  };
  tokenPrices: Array<{    // NEW! Prices included
    currency: string;
    value: string;
    lastUpdatedAt: string;
  }>;
}
```

**NFTs:**
```typescript
// Old Format
{
  tokenId: string;
  owner: string;
  contractAddress: string;
  uri: string;
  name?: string;
  symbol?: string;
  priceUSD?: number;
  standard: 'ERC721' | 'ERC1155';
  amount?: string;
}

// Portfolio API Format (Richer!)
{
  network: string;
  address: string;
  contract: {
    address: string;
    name?: string;
    symbol?: string;
    tokenType: 'ERC721' | 'ERC1155';
    openseaMetadata?: {
      floorPrice?: number;
      collectionName?: string;
      imageUrl?: string;
      // ... more metadata
    };
  };
  tokenId: string;
  name?: string;
  description?: string;
  image?: {
    cachedUrl?: string;    // NEW!
    thumbnailUrl?: string; // NEW!
    pngUrl?: string;       // NEW!
    originalUrl?: string;
  };
  raw?: {
    tokenUri?: string;
    metadata?: {
      image?: string;
      name?: string;
      description?: string;
      attributes?: Array<{  // NEW!
        trait_type?: string;
        value?: string;
      }>;
    };
  };
  // ... more fields
}
```

## Benefits of Migration

1. **Performance**
   - Single request for multiple chains vs N requests
   - Reduced network overhead
   - Faster response times

2. **Data Quality**
   - Prices included automatically
   - Richer metadata (logos, images, attributes)
   - Better structure

3. **Efficiency**
   - Less server load
   - Better caching
   - Reduced API calls

## Implementation Notes

### Portfolio API Limits

- **Tokens**: Max 2 addresses, 5 networks per address
- **NFTs**: Max 2 addresses, 15 networks per address

### Fallback Strategy

If Portfolio API fails or doesn't support all chains:
1. Try Portfolio API first
2. Fall back to old endpoints for unsupported chains
3. Combine results

### Backward Compatibility

- Old endpoints remain available
- Old format still supported
- Gradual migration possible

## Recommended Updates

### 1. Update useMultichainBalances

```typescript
// When fetching multiple chains, use Portfolio API
if (SUPPORTED_NETWORKS.length > 1) {
  const portfolioResult = await getTokensByAddressPortfolio(
    [{ address, chainIds: SUPPORTED_NETWORKS.map(n => n.chainId) }]
  );
  // Process Portfolio API format
} else {
  // Single chain - use old method
  const tokens = await getAllTokenBalances(chainId, address);
}
```

### 2. Update useGeneralNFTs

```typescript
// When fetching multiple chains, use Portfolio API
if (contractAddresses.length > 1) {
  const portfolioResult = await getNFTsByAddressPortfolio(
    [{ address, chainIds: contractAddresses.map(c => c.chainId) }]
  );
  // Process Portfolio API format
} else {
  // Single chain - use old method
  const nfts = await getNFTs(chainId, address, contractAddress);
}
```

## Testing Checklist

- [ ] Test Portfolio API endpoints work
- [ ] Test fallback to old endpoints
- [ ] Test data format conversion
- [ ] Test error handling
- [ ] Test performance improvements
- [ ] Test with single chain
- [ ] Test with multiple chains
- [ ] Test caching behavior

## Migration Timeline

**Phase 1:** ✅ Add Portfolio API functions to apiClient.ts
**Phase 2:** ⏳ Update hooks to use Portfolio API (recommended)
**Phase 3:** ⏳ Migrate frontend components to use new format (optional)

## Notes

- Old endpoints remain available for backward compatibility
- Migration can be gradual
- Portfolio API format is richer but requires frontend updates
- Performance benefits are significant for multi-chain queries
