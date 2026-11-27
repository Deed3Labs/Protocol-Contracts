# Token Balance Architecture

## Current Approach

### What `app/src/config/tokens.ts` is for:

The `COMMON_TOKENS` config file contains a **curated list of popular tokens** (USDC, USDT, DAI, WETH, etc.) per chain. It's used to:

1. **Limit which tokens we check** - We only call `balanceOf()` for tokens in this list
2. **Provide metadata** - Name, symbol, decimals, logo for known tokens
3. **Prioritize popular tokens** - Display common tokens first in the UI

### Current Implementation:

```typescript
// app/src/hooks/useMultichainBalances.ts
const tokenList = getCommonTokens(chainId); // Gets ~4-5 tokens from COMMON_TOKENS

// We call balanceOf() for EACH token in the list
for (const token of tokenList) {
  const balance = await getTokenBalance(chainId, token.address, userAddress);
}
```

**Problem**: We're only checking ~4-5 tokens per chain, missing all other tokens the user might own!

## Alchemy's `getTokenBalances` API

Alchemy has a REST API that can return **ALL ERC-20 tokens** a user owns in one call:

```typescript
// Alchemy API call
POST https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
{
  "id": 1,
  "jsonrpc": "2.0",
  "method": "alchemy_getTokenBalances",
  "params": [
    "0xUSER_ADDRESS",
    "erc20"  // ← Pass "erc20" to get ALL tokens!
  ]
}

// Response
{
  "jsonrpc": "2.0",
  "result": {
    "address": "0xUSER_ADDRESS",
    "tokenBalances": [
      {
        "contractAddress": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "tokenBalance": "0x00000000000000000000000000000000000000000000000000000000000f4240"
      },
      // ... all other tokens the user owns
    ],
    "pageKey": "..." // For pagination if user has many tokens
  }
}
```

### Benefits:

1. ✅ **Gets ALL tokens** - No need to know which tokens to check
2. ✅ **One API call** - Instead of multiple `balanceOf()` calls
3. ✅ **More efficient** - Faster and fewer RPC calls
4. ✅ **Complete coverage** - Won't miss any tokens

### Trade-offs:

1. ❌ **Requires Alchemy API key** - But we already use Alchemy RPC URLs
2. ❌ **Alchemy-specific** - Less flexible than direct RPC calls
3. ❌ **Still need metadata** - `COMMON_TOKENS` is still useful for token names/symbols/logos

## Recommended Approach

### Hybrid Solution:

1. **Use Alchemy's `getTokenBalances` API** to get ALL tokens a user owns
2. **Use `COMMON_TOKENS` config** for:
   - Token metadata (name, symbol, decimals, logo)
   - Prioritizing popular tokens in UI
   - Filtering which tokens to display (optional)

### Implementation:

```typescript
// 1. Get ALL tokens from Alchemy
const allTokens = await alchemyGetTokenBalances(address, "erc20");

// 2. Match with COMMON_TOKENS for metadata
for (const token of allTokens) {
  const tokenInfo = COMMON_TOKENS.find(t => 
    t.address.toLowerCase() === token.contractAddress.toLowerCase()
  );
  
  // Use metadata from COMMON_TOKENS if available
  // Otherwise, fetch from contract (name, symbol, decimals)
}
```

## Current vs. Proposed

| Aspect | Current (COMMON_TOKENS) | Proposed (Alchemy API) |
|--------|------------------------|------------------------|
| **Coverage** | Only ~4-5 tokens per chain | ALL tokens user owns |
| **RPC Calls** | 1 per token in list | 1 API call total |
| **Speed** | Slower (sequential calls) | Faster (one call) |
| **Flexibility** | Works with any RPC | Requires Alchemy |
| **Metadata** | Pre-configured | Need to fetch or use COMMON_TOKENS |

## Next Steps

1. **Add Alchemy REST API client** to `app/server/src/services/balanceService.ts`
2. **Implement `getAllTokenBalances()`** using Alchemy's API
3. **Keep `COMMON_TOKENS`** for metadata and UI prioritization
4. **Update `useMultichainBalances`** to use new API
5. **Add fallback** to current approach if Alchemy API unavailable
