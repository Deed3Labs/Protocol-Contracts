# Portfolio API Architecture

## Overview

This document explains how Alchemy's Portfolio APIs are integrated and how they relate to existing price and balance services.

## Portfolio API Integration

### What is Portfolio API?

Alchemy's Portfolio APIs provide a unified way to fetch tokens and NFTs across multiple chains in a single request:

- **Tokens API**: Fetches ERC20, Native, and SPL tokens with balances, metadata, and prices
- **NFTs API**: Fetches ERC721 and ERC1155 NFTs with full metadata, images, and attributes

**Key Benefits:**
- Multi-chain support (up to 2 addresses, 5 networks per address for tokens, 15 for NFTs)
- Includes metadata and prices in the same response
- More efficient than making separate API calls per chain
- Better data structure with richer information

### API Endpoints

#### Tokens
- `POST /api/token-balances/portfolio` - Get tokens across multiple chains
  - Returns Portfolio API format directly (includes metadata, prices, logos)
  - Supports: ERC20, Native tokens, SPL tokens
  - Limits: 2 addresses max, 5 networks per address

#### NFTs
- `POST /api/nfts/portfolio` - Get NFTs across multiple chains
  - Returns Portfolio API format directly (includes full metadata, images, attributes)
  - Supports: ERC721, ERC1155
  - Limits: 2 addresses max, 15 networks per address

### Data Format

**Portfolio API returns richer data than our old format:**

```typescript
// Portfolio API Token Format
{
  address: string;           // Wallet address
  network: string;           // Network identifier (e.g., "eth-mainnet")
  tokenAddress: string | null; // Token address (null for native tokens)
  tokenBalance: string;      // Balance in raw format
  tokenMetadata: {
    decimals: number;
    logo?: string;           // Logo URL
    name?: string;
    symbol?: string;
  };
  tokenPrices: Array<{       // Prices included!
    currency: string;
    value: string;
    lastUpdatedAt: string;
  }>;
  error?: string | null;
}

// Portfolio API NFT Format
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
    cachedUrl?: string;
    thumbnailUrl?: string;
    pngUrl?: string;
    originalUrl?: string;
  };
  raw?: {
    tokenUri?: string;
    metadata?: {
      image?: string;
      name?: string;
      description?: string;
      attributes?: Array<{
        trait_type?: string;
        value?: string;
      }>;
    };
  };
  // ... more fields
}
```

## Price Service Usage

### When to Use Price Service

The `priceService.ts` is still useful for:

1. **Standalone Price Queries**
   - `GET /api/prices/:chainId/:tokenAddress` - When you just need a price, not a full portfolio
   - Used by frontend for individual token price lookups

2. **Background Price Updates**
   - `priceUpdater.ts` - Background job that updates prices for common tokens every 5 minutes
   - Caches prices in Redis for fast access
   - Broadcasts price updates via WebSocket for real-time updates

3. **WebSocket Price Updates**
   - Real-time price updates for connected clients
   - Used when prices change (from the background job)

4. **Legacy Endpoints**
   - Old endpoints that don't use Portfolio API still need price service
   - For backward compatibility

### When NOT to Use Price Service

- **Portfolio API endpoints** - Prices are already included in the response
- **Multi-chain queries** - Portfolio API includes prices for all tokens

## Backward Compatibility

### Old Endpoints (Still Available)

These endpoints use the old format and conversion functions:

- `GET /api/token-balances/all/:chainId/:userAddress` - Single chain, old format
- `GET /api/nfts/:chainId/:address` - Single chain, old format
- `POST /api/token-balances/all/batch` - Batch, old format
- `POST /api/nfts/batch` - Batch, old format

### New Endpoints (Portfolio API Format)

These endpoints return Portfolio API format directly:

- `POST /api/token-balances/portfolio` - Multi-chain, Portfolio format
- `POST /api/nfts/portfolio` - Multi-chain, Portfolio format

### Migration Strategy

1. **New features** should use Portfolio API endpoints
2. **Old endpoints** remain for backward compatibility
3. **Frontend** can gradually migrate to Portfolio API format
4. **Conversion functions** (`convertPortfolioTokenToBalanceData`, `convertPortfolioNFTToGeneralNFT`) are available if needed

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend/Client                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP Requests
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Routes                              │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────────┐   │
│  │ Old Endpoints        │  │ Portfolio API Endpoints  │   │
│  │ (Backward Compat)    │  │ (New, Better Format)     │   │
│  └──────────────────────┘  └──────────────────────────┘   │
│           │                            │                    │
│           │                            │                    │
└───────────┼────────────────────────────┼────────────────────┘
            │                            │
            ▼                            ▼
┌──────────────────────┐  ┌──────────────────────────────┐
│  balanceService.ts   │  │  portfolioService.ts         │
│  nftService.ts       │  │  (Portfolio API)             │
│  (Old methods)       │  │                              │
└──────────────────────┘  └──────────────────────────────┘
            │                            │
            │                            │
            └────────────┬───────────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │   Alchemy APIs          │
            │                         │
            │  - Portfolio API        │
            │  - Prices API           │
            │  - Transfers API        │
            └────────────────────────┘
                         │
                         │
            ┌────────────────────────┐
            │   Background Jobs       │
            │                         │
            │  - priceUpdater.ts      │
            │    (Updates common      │
            │     token prices)       │
            └────────────────────────┘
```

## Recommendations

1. **Use Portfolio API for new features** - It's more efficient and provides better data
2. **Keep price service for standalone queries** - Still useful for individual price lookups
3. **Gradually migrate frontend** - Move to Portfolio API format when convenient
4. **Keep old endpoints** - For backward compatibility until migration is complete

## Performance Considerations

- **Portfolio API**: Single request for multiple chains (more efficient)
- **Old methods**: One request per chain (less efficient)
- **Price service**: Useful for caching and real-time updates
- **Caching**: Both approaches use Redis caching for performance
