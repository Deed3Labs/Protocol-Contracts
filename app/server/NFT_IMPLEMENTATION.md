# NFT Service Implementation Summary

## Architecture Decision

**General NFTs are added to `nftService.ts`** (not `balanceService.ts`)

### Reasoning:
- ✅ **Logical grouping**: Both T-Deeds and general NFTs are non-fungible tokens
- ✅ **Shared functionality**: Both use ERC721 standard (ownerOf, tokenURI, etc.)
- ✅ **Similar data structure**: Both have tokenId, owner, metadata
- ✅ **Separation of concerns**: 
  - `balanceService.ts` = Fungible tokens (ERC20)
  - `nftService.ts` = Non-fungible tokens (NFTs - both T-Deeds and general)

## Implementation

### 1. `nftService.ts` - Now handles both T-Deeds and General NFTs

**Functions:**
- `getDeedNFTs()` - T-Deeds (protocol-controlled DeedNFT contracts)
  - Fetches from DeedNFT contract
  - Includes protocol-specific metadata (definition, configuration, assetType, validation)
  - **Now includes `priceUSD`** from OpenSea

- `getGeneralNFTs()` - General ERC721 & ERC1155 NFTs (NEW)
  - Automatically detects contract standard (ERC721 or ERC1155)
  - Fetches from any ERC721 or ERC1155 contract address
  - Uses standard ERC721 and ERC1155 ABIs
  - Includes collection name/symbol
  - **Includes `priceUSD`** (collection floor price from OpenSea)
  - **ERC1155 support**: Includes `amount` field for quantity owned

### 2. `priceService.ts` - OpenSea Integration

**New Function:**
- `getOpenSeaNFTPrice()` - Gets NFT collection floor price from OpenSea API
  - Uses OpenSea API v2
  - Requires `OPENSEA_API_KEY` environment variable
  - Converts native token floor price to USD
  - Returns `null` if not available (silent failure)

**Supported Chains:**
- Ethereum (mainnet & Sepolia)
- Base (mainnet & Sepolia)
- Arbitrum
- Polygon
- Gnosis

### 3. Routes - Updated to support both types

**`/api/nfts/:chainId/:address`**
- Query params:
  - `contractAddress` (optional): If provided, fetches general NFTs from that contract
  - `type` (optional): 't-deed' or 'general' (defaults based on contractAddress)

**Behavior:**
- No `contractAddress` → Fetches T-Deeds (DeedNFT protocol contracts)
- With `contractAddress` + `type=general` → Fetches general ERC721 NFTs
- Both use same caching mechanism
- Both include price data (if available from OpenSea)

## Data Structures

### DeedNFTData (T-Deeds)
```typescript
{
  tokenId: string;
  owner: string;
  assetType: number;
  uri: string;
  definition: string;
  configuration: string;
  validatorAddress: string;
  token: string;
  salt: string;
  isMinted: boolean;
  priceUSD?: number; // NEW: From OpenSea
}
```

### GeneralNFTData (General NFTs - ERC721 & ERC1155)
```typescript
{
  tokenId: string;
  owner: string;
  contractAddress: string;
  uri: string;
  name?: string; // Collection name
  symbol?: string; // Collection symbol
  priceUSD?: number; // Collection floor price from OpenSea
  standard: 'ERC721' | 'ERC1155'; // Token standard
  amount?: string; // For ERC1155: quantity owned (always "1" for ERC721)
}
```

## OpenSea API Setup

**Required Environment Variable:**
```bash
OPENSEA_API_KEY=your_opensea_api_key_here
```

**Get API Key:**
1. Go to https://docs.opensea.io/reference/api-overview
2. Sign up for OpenSea API access
3. Get your API key from the dashboard

**Note:** OpenSea API has rate limits. The implementation includes:
- 5 second timeout per request
- Silent error handling (returns null if fails)
- Optional pricing (doesn't block NFT fetching if pricing fails)

## Usage Examples

### Fetch T-Deeds (default)
```typescript
GET /api/nfts/84532/0x1234...
// Returns T-Deeds owned by address
```

### Fetch General NFTs
```typescript
GET /api/nfts/84532/0x1234...?contractAddress=0x5678...&type=general
// Returns general ERC721 or ERC1155 NFTs from specified contract
// Automatically detects which standard the contract uses
```

### Batch Fetch
```typescript
POST /api/nfts/batch
Body: {
  requests: [
    { chainId: 84532, address: "0x1234..." }, // T-Deeds
    { chainId: 84532, address: "0x1234...", contractAddress: "0x5678..." } // General NFTs
  ]
}
```

## Performance Considerations

1. **Pricing is optional and async**: NFT fetching doesn't wait for pricing
2. **Caching**: Both T-Deeds and general NFTs are cached (10 min TTL)
3. **Rate limits**: OpenSea API calls are rate-limited, so pricing may not always be available
4. **Batch processing**: NFTs are fetched in batches of 10 for efficiency

## ERC1155 Limitations

**Current Implementation:**
- ERC1155 enumeration uses a tokenId range search (0-1000)
- This is a limitation - ERC1155 doesn't have a standard way to enumerate owned tokens
- For production, consider:
  - Using indexed TransferSingle/TransferBatch events
  - Integrating with services like Alchemy/Moralis that track ERC1155 ownership
  - Maintaining a database of known tokenIds per contract

**Why this limitation exists:**
- ERC1155 uses `balanceOf(address, tokenId)` which requires knowing the tokenId
- Unlike ERC721's `tokenOfOwnerByIndex`, there's no standard enumeration function
- Events are the most reliable way to track ERC1155 ownership, but require indexing

## Future Enhancements

1. **Individual NFT pricing**: Currently uses collection floor price, could add individual NFT valuation
2. **Multiple pricing sources**: Could add fallback to other NFT pricing APIs
3. **Caching prices separately**: Cache NFT prices separately from NFT data for faster updates
4. **ERC1155 event indexing**: Implement TransferSingle/TransferBatch event indexing for accurate ERC1155 ownership tracking
5. **ERC1155 tokenId discovery**: Integrate with services that track ERC1155 tokenIds or implement custom indexing
