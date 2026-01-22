# Hooks Comparison: Native vs Token Balances

## `useMultichainBalances` vs `useMultichainTokenBalances`

### Key Difference

**`useMultichainBalances`** - Fetches **native token balances** (ETH, BASE, etc.)
**`useMultichainTokenBalances`** - Fetches **ERC20 token balances** (USDC, USDT, WETH, etc.)

---

## `useMultichainBalances` (Native Tokens)

### What it does:
- Fetches the **native cryptocurrency** balance for each supported chain
- Examples: ETH on Ethereum, BASE on Base, etc.
- One balance per chain (the chain's native currency)

### Data Structure:
```typescript
interface MultichainBalance {
  chainId: number;
  chainName: string;
  balance: string;              // Formatted balance (e.g., "1.2345")
  balanceWei: bigint;           // Raw balance in wei
  balanceUSD: number;           // USD value
  currencySymbol: string;        // "ETH", "BASE", etc.
  currencyName: string;          // "Ether", "Base", etc.
  isLoading: boolean;
  error: string | null;
}
```

### Return Value:
```typescript
{
  balances: MultichainBalance[];  // One per chain
  totalBalance: string;            // Sum of all native balances
  totalBalanceUSD: number;        // Total USD value
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshChain: (chainId: number) => Promise<void>;
}
```

### How it works:
1. Calls `provider.getBalance(address)` for each chain
2. Uses server API: `/api/balances/:chainId/:address`
3. Falls back to direct RPC calls via `getBalanceOptimized()`
4. Converts to USD using ETH price (assumes all native tokens ≈ ETH price)

### Example Output:
```javascript
[
  {
    chainId: 1,
    chainName: "Ethereum",
    balance: "0.0266",
    balanceWei: 26600000000000000n,
    balanceUSD: 78.06,
    currencySymbol: "ETH",
    currencyName: "Ether"
  },
  {
    chainId: 8453,
    chainName: "Base",
    balance: "0.0188",
    balanceWei: 18800000000000000n,
    balanceUSD: 55.17,
    currencySymbol: "BASE",
    currencyName: "Base"
  }
]
```

---

## `useMultichainTokenBalances` (ERC20 Tokens)

### What it does:
- Fetches **ERC20 token balances** across all supported chains
- Examples: USDC, USDT, DAI, WETH on each chain
- Multiple tokens per chain (from `COMMON_TOKENS` list)

### Data Structure:
```typescript
interface MultichainTokenBalance {
  address: string;              // Token contract address
  symbol: string;               // "USDC", "WETH", etc.
  name: string;                 // "USD Coin", "Wrapped Ether", etc.
  decimals: number;             // Token decimals
  balance: string;              // Formatted balance
  balanceRaw: bigint;           // Raw balance
  balanceUSD: number;           // USD value
  chainId: number;              // Which chain
  chainName: string;            // Chain name
  logoUrl?: string;              // Optional logo
}
```

### Return Value:
```typescript
{
  tokens: MultichainTokenBalance[];  // All tokens across all chains
  totalValueUSD: number;             // Total USD value of all tokens
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshChain: (chainId: number) => Promise<void>;
}
```

### How it works:
1. For each chain, fetches balances for tokens in `COMMON_TOKENS[chainId]`
2. Uses server API: `/api/token-balances/batch` (batch endpoint)
3. Falls back to batch RPC calls via `executeBatchRpcCalls()`
4. Fetches token metadata (symbol, name, decimals) from contract
5. Gets individual token prices (not just ETH price)

### Example Output:
```javascript
[
  {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    balance: "29.62",
    balanceRaw: 29620000n,
    balanceUSD: 29.62,
    chainId: 1,
    chainName: "Ethereum"
  },
  {
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    balance: "0.0266",
    balanceRaw: 26600000000000000n,
    balanceUSD: 78.06,
    chainId: 1,
    chainName: "Ethereum"
  },
  // ... more tokens from other chains
]
```

---

## Side-by-Side Comparison

| Feature | `useMultichainBalances` | `useMultichainTokenBalances` |
|---------|------------------------|------------------------------|
| **What it fetches** | Native token (ETH, BASE, etc.) | ERC20 tokens (USDC, USDT, WETH, etc.) |
| **Items per chain** | 1 (the native currency) | Multiple (from COMMON_TOKENS list) |
| **API endpoint** | `/api/balances/:chainId/:address` | `/api/token-balances/batch` |
| **RPC method** | `eth_getBalance` | `eth_call` (balanceOf) |
| **Price source** | ETH price (assumes all native ≈ ETH) | Individual token prices (Uniswap/CoinGecko) |
| **Contract calls** | None (native balance) | Yes (symbol, name, decimals, balanceOf) |
| **Batch support** | Yes (`getBalancesBatch`) | Yes (`getTokenBalancesBatch`) |
| **Use case** | Show native currency holdings | Show token holdings (stablecoins, etc.) |

---

## When to Use Which

### Use `useMultichainBalances` when:
- ✅ You need to show native currency balances (ETH, BASE, etc.)
- ✅ You want one balance per chain
- ✅ You're building a wallet overview showing native holdings
- ✅ You need fast, simple balance checks

### Use `useMultichainTokenBalances` when:
- ✅ You need to show ERC20 token balances (USDC, USDT, etc.)
- ✅ You want to see all token holdings across chains
- ✅ You're building a portfolio view with tokens
- ✅ You need individual token prices (not just ETH price)

---

## Example Usage

### Native Balances:
```typescript
const { balances, totalBalanceUSD } = useMultichainBalances();

// Shows: ETH on Ethereum, BASE on Base, etc.
balances.forEach(balance => {
  console.log(`${balance.chainName}: ${balance.balance} ${balance.currencySymbol}`);
});
```

### Token Balances:
```typescript
const { tokens, totalValueUSD } = useMultichainTokenBalances();

// Shows: USDC, WETH, etc. across all chains
tokens.forEach(token => {
  console.log(`${token.symbol} on ${token.chainName}: ${token.balance}`);
});
```

---

## Summary

- **Native balances** = The chain's built-in currency (ETH, BASE, etc.)
- **Token balances** = ERC20 tokens deployed on the chain (USDC, USDT, etc.)

Both hooks:
- ✅ Use server API first (with Redis caching)
- ✅ Fall back to direct RPC calls
- ✅ Support batch operations
- ✅ Calculate USD values
- ✅ Work across all supported chains
