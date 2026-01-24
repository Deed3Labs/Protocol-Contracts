# Alchemy NFT Pricing Implementation

## Overview

We've updated the NFT pricing service to use Alchemy's NFT API as the primary source for floor prices, with OpenSea as a fallback.

## Implementation

### Primary: Alchemy NFT API
- **Endpoint**: `GET /nft/v3/{apiKey}/getFloorPrice?contractAddress={address}`
- **Availability**: Ethereum Mainnet only (chainId: 1)
- **Marketplaces**: OpenSea and LooksRare
- **Response**: Floor price in ETH (or native token)

### Fallback: OpenSea API
- Used when Alchemy NFT API is unavailable (non-Ethereum chains or if Alchemy fails)
- Supports multiple chains: Ethereum, Base, Polygon, Arbitrum, Gnosis
- Requires `OPENSEA_API_KEY` environment variable

## API Flow

```
getNFTFloorPrice(chainId, contractAddress)
  ↓
  ├─→ getAlchemyNFTFloorPrice() [Primary]
  │     └─→ Only on Ethereum mainnet (chainId: 1)
  │     └─→ Returns floor price in ETH
  │     └─→ Converts to USD using native token price
  │
  └─→ getOpenSeaNFTPrice() [Fallback]
        └─→ Used for all other chains or if Alchemy fails
        └─→ Returns floor price in USD
```

## Configuration

### Required Environment Variables

```bash
# Alchemy API Key (for NFT pricing on Ethereum mainnet)
ALCHEMY_API_KEY=your_alchemy_api_key

# OpenSea API Key (for fallback pricing on other chains)
OPENSEA_API_KEY=your_opensea_api_key
```

## Usage

### In NFT Service

```typescript
// T-Deeds
const price = await getNFTFloorPrice(chainId, contractAddress);

// General NFTs
const floorPrice = await getNFTFloorPrice(chainId, contractAddress);
```

## Supported Chains

### Alchemy NFT API (Primary)
- ✅ **Ethereum Mainnet (1)**: Full support via Alchemy NFT API

### OpenSea API (Fallback)
- ✅ **Ethereum Mainnet (1)**: Fallback if Alchemy fails
- ✅ **Base Mainnet (8453)**: OpenSea only
- ✅ **Polygon (137)**: OpenSea only
- ✅ **Arbitrum One (42161)**: OpenSea only
- ✅ **Gnosis (100)**: OpenSea only
- ✅ **Testnets**: OpenSea only (if supported)

## Response Format

### Alchemy API Response
```json
{
  "openSea": {
    "floorPrice": 0.5,
    "priceCurrency": "ETH",
    "collectionUrl": "https://opensea.io/collection/...",
    "retrievedAt": "2024-01-01T00:00:00Z"
  },
  "looksRare": {
    "floorPrice": 0.48,
    "priceCurrency": "ETH",
    ...
  }
}
```

### Price Conversion
1. Get floor price in ETH from Alchemy
2. Get ETH price in USD using `getTokenPrice()`
3. Calculate: `floorPriceUSD = floorPriceETH * ethPriceUSD`

## Benefits

1. **Faster**: Alchemy API is typically faster than OpenSea
2. **More Reliable**: Alchemy has better uptime and rate limits
3. **Multiple Marketplaces**: Returns prices from both OpenSea and LooksRare
4. **Automatic Fallback**: Seamlessly falls back to OpenSea if Alchemy unavailable

## Limitations

- **Ethereum Mainnet Only**: Alchemy's `getFloorPrice` endpoint is only available on Ethereum mainnet
- **Other Chains**: Automatically use OpenSea for Base, Polygon, Arbitrum, etc.
- **API Keys Required**: Both Alchemy and OpenSea require API keys for production use

## Testing

### Test Alchemy NFT API

```bash
# Test on Ethereum mainnet
curl "https://eth-mainnet.g.alchemy.com/nft/v3/YOUR_API_KEY/getFloorPrice?contractAddress=0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D"
```

### Test from Server

```bash
# The server will automatically use Alchemy for Ethereum mainnet
# and OpenSea for other chains
curl "http://localhost:3001/api/nfts/1/0xYOUR_ADDRESS"
```

## Migration Notes

- ✅ **Backward Compatible**: Existing OpenSea integration still works as fallback
- ✅ **No Breaking Changes**: All existing code continues to work
- ✅ **Automatic**: No code changes needed in NFT service - uses `getNFTFloorPrice()` automatically
