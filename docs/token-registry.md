## Token Registry

### Overview

`TokenRegistry` is the protocol’s single source of truth for token onboarding and metadata. Its presence-based whitelist model defines which tokens the protocol recognizes. It centralizes:

- Token whitelisting (presence in the registry)
- Per-chain token addresses (chainId → address)
- Stablecoin classification
- Fallback pricing (USD, 18 decimals)
- Human-readable metadata (symbol, name, decimals)

Downstream contracts (e.g., `AssuranceOracle`, `AssurancePool`, `Validator`, `FundManager`) read from the registry for consistent policy and safer defaults.

### Why a central registry?

- Single source of truth: Update once, reflected everywhere.
- Consistency: Avoids desync across contracts and deployments.
- Operational simplicity: Easier governance, monitoring, and audits.
- Resilience: Controlled fallback prices when market feeds fail.
- Separation of concerns: Oracle focuses on price selection; registry holds token data.

### Data model

For each token (keyed by its address on this chain):

- isWhitelisted: bool (presence in the registry tracked by an index + boolean map)
- stablecoin: bool (explicit classification for $1 semantics)
- symbol: string (optional metadata)
- name: string (optional metadata)
- decimals: uint8 (optional metadata)
- chainAddresses: mapping(uint256 chainId → address tokenOnChain)
- fallbackPrice: uint256 (USD price with 18 decimals; stored in separate map)

Notes:
- Whitelisting is presence-based (added to `whitelistedList` and flagged in `isWhitelisted`).
- Fallback price defaults to 1e18 ($1) during registration if omitted.

### Core responsibilities

- Canonical onboarding via `registerToken(...)` (sets chain mapping, fallback price, and whitelists)
- Updates via granular setters: metadata, stablecoin flag, additional chain mappings, and fallback price
- Removal via `removeToken(...)` (de-lists token and clears associated data)

### Contract interactions

- `AssuranceOracle`
  - Reads `getIsWhitelisted`, `getIsStablecoin`, `getFallbackPrice`, and may prefer fallback pricing using its own policy flag.
- `AssurancePool`
  - Indirectly benefits from consistent token acceptance and pricing through the oracle.
- `Validator` and `FundManager`
  - Use `getIsWhitelisted` to expand allowed tokens alongside local policy when applicable.

### Admin/Governance

All mutating functions are owner/admin-gated. Recommended flow:

1) Add a token (minimal happy path):
   - `registerToken(token, chainId, chainTokenAddress, fallbackPrice)`
   - If `fallbackPrice == 0`, the token defaults to $1.

2) Update fields over time:
   - `setFallbackPrice(token, price)`
   - `setStablecoin(token, isStablecoin)`
   - `setChainAddress(token, chainId, chainTokenAddress)`
   - `setTokenMetadata(token, symbol, name, decimals)`

3) Remove a token:
   - `removeToken(token)`

### Public read API (key calls)

- `getIsWhitelisted(address token) → bool`
- `getIsStablecoin(address token) → bool`
- `getTokenInfo(address token) → TokenInfo { whitelisted, stablecoin, decimals, symbol, name }`
- `getChainAddress(address token, uint256 chainId) → address`
- `getFallbackPrice(address token) → uint256`
- `getWhitelistedTokens() → address[]`
- `hasPricingData(address token) → bool`
- `getPriceSource(address token) → string` ("stablecoin" | "fallback" | "default")

### Write API (admin)

- `registerToken(address token, uint256 chainId, address chainTokenAddress, uint256 fallbackPrice)`
  - Whitelists token, sets chain address and fallback price (1e18 if zero).
- `removeToken(address token)`
  - Removes whitelist entry, fallback price, and all metadata/chain mappings.
- `setStablecoin(address token, bool isStablecoin)`
- `setTokenMetadata(address token, string symbol, string name, uint8 decimals)`
- `setChainAddress(address token, uint256 chainId, address chainTokenAddress)`
- `setFallbackPrice(address token, uint256 price)`
- `batchSetFallbackPrices(address[] tokens, uint256[] prices)`

### Events

- `TokenWhitelisted(token, whitelisted)`
- `TokenStablecoinFlagUpdated(token, isStablecoin)`
- `TokenMetadataUpdated(token, symbol, name, decimals)`
- `TokenChainAddressSet(token, chainId, chainTokenAddress)`
- `FallbackPriceUpdated(token, newPrice)`

### Typical onboarding flow

1) Project governance decides to support token T on chain C.
2) Registry admin calls `registerToken(T, C, T_on_C, priceOrZero)`.
3) Oracle and other contracts immediately recognize T as whitelisted; oracle will use Uniswap first, then fallback price as needed (or prefer fallback if told to via oracle policy).

### Examples

Register a token with default $1 fallback:

```
registerToken(0xToken, 84532, 0xTokenOnBaseSepolia, 0)
```

Register a token with explicit fallback price:

```
registerToken(0xToken, 84532, 0xTokenOnBaseSepolia, 2_000000000000000000) // $2.00
```

Update fallback price later:

```
setFallbackPrice(0xToken, 1500000000000000000) // $1.50
```

Mark a token as stablecoin:

```
setStablecoin(0xUSDS, true)
```

Remove a token entirely:

```
removeToken(0xToken)
```

### Security considerations

- Admin-only mutations: Ensure governance/owner roles are protected (multisig, timelocks as appropriate).
- Fallback pricing authority: Changes affect protocol pricing when market feeds fail; audit and monitor events.
- Chain address mappings: Incorrect addresses can mislead off-chain clients and cross-chain flows; validate before setting.

### Versioning / Upgrades

The registry is designed to evolve without requiring downstream changes. Adding fields or methods should preserve existing read APIs so consumers remain compatible.


