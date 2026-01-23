# NFT List Architecture

## Overview

Similar to how we handle tokens with `COMMON_TOKENS`, we now have `NFT_CONTRACTS` that defines which NFT collections to check for each chain. This makes NFT fetching:
- **Simple**: Just like tokens, we check a known list
- **Categorized**: Each NFT can be marked as `rwa`, `collectible`, or `general`
- **Efficient**: Only checks specified contracts, not all possible NFTs

## Why We Can't Query Wallets Directly

### Tokens (Native/ERC20) ✅ Easy
```typescript
// We know which tokens to check (limited list)
COMMON_TOKENS = {
  1: [USDC, USDT, DAI, WETH],  // ~5 tokens
  8453: [USDC, WETH],          // ~2 tokens
}

// We call balanceOf(address) on each known contract
for (const token of COMMON_TOKENS[chainId]) {
  const balance = await contract.balanceOf(userAddress); // 1 RPC call
}
// Total: ~5-10 RPC calls per chain
```

### NFTs ❌ Can't Query Wallet Directly
```typescript
// Problem: There are MILLIONS of NFT contracts!
// - Bored Apes: 0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D
// - CryptoPunks: 0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB
// - Your custom NFT: 0x1234...
// - Another NFT: 0x5678...
// ... millions more

// We can't check them all - it would be:
// - Millions of RPC calls
// - Extremely slow
// - Very expensive
```

**Solution**: Use an NFT list (like `COMMON_TOKENS`) to specify which contracts to check.

## NFT List Configuration

### File: `app/src/config/nfts.ts`

```typescript
export type NFTType = 'rwa' | 'collectible' | 'general';

export interface NFTContractConfig {
  address: string;
  name: string;
  symbol?: string;
  type: NFTType; // RWA, Collectible, or General NFT
  standard: 'ERC721' | 'ERC1155';
  logoUrl?: string;
  description?: string;
}

export const NFT_CONTRACTS: Record<number, NFTContractConfig[]> = {
  84532: [
    {
      address: '0x1a4e89225015200f70e5a06f766399a3de6e21E6',
      name: 'DeedNFT',
      symbol: 'T-Deed',
      type: 'rwa',
      standard: 'ERC721',
      description: 'Real World Asset (RWA) T-Deed tokens',
    },
    // Add more NFT contracts here
  ],
};
```

## How It Works

### 1. T-Deeds (Protocol RWAs)
- **Source**: `useMultichainDeedNFTs()`
- **Contracts**: Uses `getContractAddress(chainId, 'DeedNFT')` from server config
- **Type**: Always `rwa`
- **Method**: Calls `balanceOf(address)` then `tokenOfOwnerByIndex(address, i)`
- **Efficiency**: ✅ Only checks user-owned tokens

### 2. General NFTs (from NFT List)
- **Source**: `useGeneralNFTs()` with contracts from `NFT_CONTRACTS`
- **Contracts**: All contracts in `NFT_CONTRACTS` config
- **Type**: `rwa` | `collectible` | `general` (from config)
- **Method**: 
  - ERC721: `balanceOf(address)` then `tokenOfOwnerByIndex(address, i)`
  - ERC1155: Checks tokenIds 0-100 with `balanceOf(address, tokenId)`
- **Efficiency**: ✅ Only checks user-owned tokens (ERC721) or limited range (ERC1155)

### 3. User-Provided Contracts
- **Source**: `useGeneralNFTs()` with user-provided contracts
- **Contracts**: Additional contracts passed to `usePortfolioHoldings([...])`
- **Type**: Defaults to `general` (can be overridden in config)
- **Method**: Same as General NFTs above

## Benefits

1. **Simple**: Just add NFT contracts to the config, no code changes needed
2. **Categorized**: Easy to filter by type (RWA, Collectible, General)
3. **Efficient**: Only checks specified contracts, not all possible NFTs
4. **Consistent**: Same pattern as `COMMON_TOKENS` for tokens

## Adding New NFT Contracts

Simply add to `NFT_CONTRACTS` in `app/src/config/nfts.ts`:

```typescript
84532: [
  {
    address: '0x1a4e89225015200f70e5a06f766399a3de6e21E6',
    name: 'DeedNFT',
    type: 'rwa',
    standard: 'ERC721',
  },
  {
    address: '0x...', // New NFT contract
    name: 'Cool Collectibles',
    type: 'collectible',
    standard: 'ERC721',
  },
],
```

## About Alchemy's getTokenBalances

**Question**: Can we use Alchemy's `getTokenBalances` API for native/ERC20 tokens?

**Answer**: Yes, but we're already using a similar approach:

1. **Current Approach**: Direct RPC calls via `getBalance()` and `balanceOf()`
   - ✅ Works with any RPC provider (Alchemy, Infura, public, etc.)
   - ✅ No API key required (can use public RPCs)
   - ✅ More flexible

2. **Alchemy's getTokenBalances API**:
   - ✅ Can return all token balances in one call
   - ❌ Requires Alchemy API key
   - ❌ Still need to know which tokens to check (same limitation)
   - ❌ Adds dependency on Alchemy

**Recommendation**: Keep current approach. We're already using Alchemy RPC URLs (via `ALCHEMY_API_KEY`), which gives us the benefits without the API dependency. If you want to use Alchemy's REST API for token balances, we can add it as an optional enhancement, but it's not necessary since we have a limited token list.
