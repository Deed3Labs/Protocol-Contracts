# New Networks Added ✅

## Summary

Added support for three new blockchain networks:
- **Arbitrum One** (chainId: 42161)
- **Polygon** (chainId: 137)
- **Gnosis** (chainId: 100)

## Changes Made

### 1. Network Configuration (`app/src/config/networks.ts`)

#### Added to `SUPPORTED_NETWORKS`:
- **Arbitrum One** (42161)
  - Native: ETH
  - RPC: Infura (with fallback to public)
  - Explorer: https://arbiscan.io

- **Polygon** (137)
  - Native: MATIC
  - RPC: Infura (with fallback to public)
  - Explorer: https://polygonscan.com

- **Gnosis** (100)
  - Native: xDAI
  - RPC: Public RPC
  - Explorer: https://gnosisscan.io

#### Added to `networks` object:
- Full network configurations with contract placeholders

#### Updated `chainIdToDir` mapping:
- Added mappings for ABI path resolution

### 2. Token Configuration (`app/src/config/tokens.ts`)

#### Added token lists for each new chain:

**Arbitrum One (42161)**:
- USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- USDT: `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`
- DAI: `0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1`
- WETH: `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`

**Polygon (137)**:
- USDC: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`
- USDT: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`
- DAI: `0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063`
- WETH: `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619`
- WMATIC: `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270`

**Gnosis (100)**:
- USDC: `0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83`
- USDT: `0x4ECaBa5870353805a9F068101A40E0f32ed605C6`
- WXDAI: `0xe91D153E0b41518A2Ce8Dd3D7944F8638934d2C8`

### 3. Pricing Configuration (`app/src/hooks/usePricingData.ts`)

#### Added Uniswap V3 Factory addresses:
- Arbitrum One: `0x1F98431c8aD98523631AE4a59f267346ea31F984`
- Polygon: `0x1F98431c8aD98523631AE4a59f267346ea31F984`
- Gnosis: `0x1F98431c8aD98523631AE4a59f267346ea31F984`

#### Added USDC addresses:
- Arbitrum One: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- Polygon: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`
- Gnosis: `0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83`

#### Added WETH/Wrapped native addresses:
- Arbitrum One: `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`
- Polygon: `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619`
- Gnosis: `0xe91D153E0b41518A2Ce8Dd3D7944F8638934d2C8` (WXDAI)

#### Updated CoinGecko platform mapping:
- Arbitrum One: `arbitrum-one`
- Polygon: `polygon-pos`
- Gnosis: `xdai`

#### Added native token pricing:
- New function: `getNativeTokenPrice(chainId)` - Fetches native token price per chain
- New function: `getNativeTokenCoinGeckoId(chainId)` - Maps chain to CoinGecko ID
- Handles: ETH, MATIC, xDAI with appropriate CoinGecko IDs

### 4. Native Balance Hook (`app/src/hooks/useMultichainBalances.ts`)

#### Updated to fetch per-chain native token prices:
- Fetches native token price for each chain individually
- Handles ETH (Ethereum, Base, Arbitrum), MATIC (Polygon), xDAI (Gnosis)
- Falls back to default ETH price if chain-specific price fetch fails

## Native Token Pricing

| Chain | Native Token | CoinGecko ID | Price Source |
|-------|--------------|--------------|--------------|
| Ethereum | ETH | `ethereum` | CoinGecko |
| Base | ETH | `ethereum` | CoinGecko |
| Arbitrum | ETH | `ethereum` | CoinGecko |
| Polygon | MATIC | `matic-network` | CoinGecko |
| Gnosis | xDAI | `xdai` | CoinGecko (defaults to $1 if fails) |

## Token Support

All new chains now support:
- ✅ Native token balances (ETH, MATIC, xDAI)
- ✅ ERC20 token balances (USDC, USDT, DAI, WETH, etc.)
- ✅ Token price fetching (Uniswap → CoinGecko)
- ✅ Stablecoin detection and $1 pricing
- ✅ Multichain aggregation

## Testing

To test the new networks:
1. Connect wallet with balances on Arbitrum, Polygon, or Gnosis
2. Check portfolio view - balances should appear automatically
3. Verify native token prices are correct (MATIC and xDAI should have different prices than ETH)
4. Verify stablecoin balances show in cash balance

## Notes

- Contract addresses are placeholders (`0x0000...`) - update when contracts are deployed
- RPC URLs use Infura with public fallbacks
- All chains are automatically included in multichain hooks
- No breaking changes - existing chains continue to work
