# Token registry

`TokenRegistry` holds token policy for the protocol in one place: which tokens are accepted, which
are treated as stablecoins, a fallback price for each, per-chain addresses and display metadata.
Contracts that need token policy read it from here rather than keeping their own copy.

It covers:

- Token whitelisting (presence in the registry)
- Per-chain token addresses (chainId → address)
- Stablecoin classification
- Fallback pricing (USD, 18 decimals)
- Display metadata (symbol, name, decimals)

## Who reads it

| Contract | Reads | Used for |
|---|---|---|
| `AssuranceOracle` | `getIsWhitelisted`, `getIsStablecoin`, `getFallbackPrice`, `getWhitelistedTokens`, `hasPricingData`, `getPriceSource` | Which tokens it prices, which it treats as $1, and the fallback when no pool price is available |
| `Validator`, `FundManager` | `getIsWhitelisted` | Accepting a token that is either on their own local list or whitelisted here |

`AssurancePool` never reads the registry directly. It accepts a token when the oracle does, so the
registry reaches it through the oracle. See [The reserve](./reserve.md).

## Data model

For each token, keyed by its address on this chain:

| Field | Type | Notes |
|---|---|---|
| Whitelisted | `bool` | Presence-based: a token is whitelisted when it is in `whitelistedList` and flagged in `isWhitelisted` |
| Stablecoin | `bool` | The oracle prices a flagged token at $1 |
| Fallback price | `uint256` | USD with 18 decimals, in its own mapping |
| Chain addresses | `mapping(uint256 => address)` | The token's address on other chains |
| Symbol, name, decimals | `string`, `string`, `uint8` | Optional metadata |

`getTokenInfo` returns the stored metadata. When none has been set, it reads `decimals()` from the
token itself and returns that, with an empty symbol and name.

## Write functions

Every write is `onlyOwner` (OpenZeppelin `Ownable`). The contract is a plain deployment, not an
upgradeable proxy.

| Function | Effect |
|---|---|
| `registerToken(token, chainId, chainTokenAddress, fallbackPrice)` | Sets the chain address and the fallback price (`1e18`, $1, when given 0), and whitelists the token |
| `setFallbackPrice(token, price)` | Sets the price, which must be non-zero, and whitelists the token if it is not already |
| `batchSetFallbackPrices(tokens, prices)` | `setFallbackPrice` for each pair |
| `setStablecoin(token, isStablecoin)` | Sets the flag. Does not whitelist |
| `setChainAddress(token, chainId, chainTokenAddress)` | Adds or changes one chain mapping |
| `setTokenMetadata(token, symbol, name, decimals)` | Sets the display metadata |
| `removeToken(token)` | De-lists the token and clears its fallback price, stablecoin flag and metadata |

`removeToken` uses `delete` on the token's record, which in Solidity does not clear a nested
mapping. Chain addresses set for a removed token therefore remain readable through
`getChainAddress`, and reappear if the token is registered again.

## Read functions

- `getIsWhitelisted(address token) → bool`
- `getIsStablecoin(address token) → bool`
- `getTokenInfo(address token) → TokenInfo { whitelisted, stablecoin, decimals, symbol, name }`
- `getChainAddress(address token, uint256 chainId) → address`
- `getFallbackPrice(address token) → uint256`
- `getWhitelistedTokens() → address[]`
- `hasPricingData(address token) → bool`: true with a fallback price or the stablecoin flag
- `getPriceSource(address token) → string`: `"stablecoin"`, `"fallback"` or `"default"`

## Events

- `TokenWhitelisted(token, whitelisted)`
- `TokenStablecoinFlagUpdated(token, isStablecoin)`
- `TokenMetadataUpdated(token, symbol, name, decimals)`
- `TokenChainAddressSet(token, chainId, chainTokenAddress)`
- `FallbackPriceUpdated(token, newPrice)`

## Onboarding a token

1. The registry owner calls `registerToken(T, C, T_on_C, priceOrZero)`.
2. If the token is a dollar stablecoin, the owner also calls `setStablecoin(T, true)`.
3. The oracle accepts T at once. It prices it at $1 if it is flagged as a stablecoin; otherwise from
   a Uniswap time-weighted average, falling back to the registry price, or from the registry price
   first if the oracle's `forceRegistryFallback` is set for T. The order is in
   [The reserve](./reserve.md#pricing--assuranceoracle).

`deploy/14_register_CLRUSD_in_registry.ts` registers CLRUSD this way, with its metadata and the
stablecoin flag.

### Examples

Register a token with the default $1 fallback:

```
registerToken(0xToken, 84532, 0xTokenOnBaseSepolia, 0)
```

Register a token with an explicit fallback price:

```
registerToken(0xToken, 84532, 0xTokenOnBaseSepolia, 2_000000000000000000) // $2.00
```

Update the fallback price later:

```
setFallbackPrice(0xToken, 1500000000000000000) // $1.50
```

Mark a token as a stablecoin:

```
setStablecoin(0xUSDS, true)
```

Remove a token:

```
removeToken(0xToken)
```

## Security considerations

- **Owner-only writes.** Whoever owns the registry decides which tokens the oracle accepts and what
  they are worth when market prices are unavailable. Who holds that key is in
  [Governance](../governance/README.md).
- **Fallback prices.** A fallback price is used whenever the oracle cannot read a pool price, and
  always for a token the oracle forces to the registry. Watch `FallbackPriceUpdated`.
- **Stablecoin flag.** A flagged token is valued at $1 regardless of its market price.
- **Chain addresses.** Off-chain clients and cross-chain flows read these; a wrong address
  misleads them. Chain addresses also survive `removeToken`, as noted above.
