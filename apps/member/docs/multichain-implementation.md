# Multichain Implementation Guide

## Overview

The app now supports multichain functionality, allowing users to view and interact with their assets across all supported networks without manually switching chains. The implementation aggregates balances, holdings, and activity from all configured networks in `app/src/config/networks.ts`.

## Key Features

1. **Automatic Chain Detection**: The app automatically queries all supported networks in parallel
2. **Aggregated Views**: Balances, tokens, NFTs, and transactions are consolidated across all chains
3. **Seamless Transactions**: Transactions automatically switch to the correct chain when needed
4. **No Manual Chain Switching**: Users don't need to manually switch chains to view their data

## Architecture

### Multichain Hooks

The implementation includes several hooks that aggregate data across chains:

#### `useMultichainBalances`
Fetches native token balances (ETH, etc.) across all supported networks.

```typescript
const { 
  balances,           // Array of balances per chain
  totalBalance,       // Aggregated balance string
  totalBalanceUSD,    // Aggregated balance in USD
  isLoading,
  error,
  refresh,
  refreshChain
} = useMultichainBalances();
```

#### `useMultichainTokenBalances`
Fetches ERC20 token balances across all chains.

```typescript
const {
  tokens,            // Array of tokens with chainId included
  totalValueUSD,     // Total value of all tokens
  isLoading,
  error,
  refresh,
  refreshChain
} = useMultichainTokenBalances();
```

#### `useMultichainDeedNFTs`
Fetches DeedNFTs across all chains where contracts are deployed.

```typescript
const {
  nfts,             // Array of NFTs with chainId included
  totalCount,
  isLoading,
  error,
  refresh,
  refreshChain
} = useMultichainDeedNFTs();
```

#### `useMultichainActivity`
Fetches transaction history across all chains.

```typescript
const {
  transactions,      // Array of transactions with chainId included
  isLoading,
  error,
  refresh,
  refreshChain
} = useMultichainActivity(limit);
```

### Transaction Utilities

The `multichainUtils.ts` file provides utilities for handling chain-specific operations:

#### `ensureChain(chainId: number)`
Automatically switches to the specified chain if not already on it. Returns `true` if successful.

```typescript
import { ensureChain } from '@/utils/multichainUtils';

// Before executing a transaction
await ensureChain(84532); // Switch to Base Sepolia
```

#### `getChainProvider(chainId: number, forWrite: boolean)`
Gets a provider for a specific chain. If `forWrite` is true, it will switch to that chain first.

```typescript
import { getChainProvider } from '@/utils/multichainUtils';

const provider = await getChainProvider(84532, false); // Read-only
const writeProvider = await getChainProvider(84532, true); // Will switch chain
```

#### `executeTransactionOnChain(chainId: number, transaction: TransactionRequest)`
Executes a transaction on a specific chain, automatically switching if needed.

```typescript
import { executeTransactionOnChain } from '@/utils/multichainUtils';

const tx = await executeTransactionOnChain(84532, {
  to: contractAddress,
  data: encodedData,
  value: ethers.parseEther('0.1')
});
```

## Usage in Components

### BrokerageHome Component

The `BrokerageHome` component has been updated to use multichain hooks:

```typescript
// Old (single chain)
const { balance, balanceUSD } = useWalletBalance();
const { tokens } = useTokenBalances();
const { userDeedNFTs } = useDeedNFTData();

// New (multichain)
const { totalBalance, totalBalanceUSD, balances } = useMultichainBalances();
const { tokens } = useMultichainTokenBalances();
const { nfts } = useMultichainDeedNFTs();
```

### Displaying Chain Information

When displaying holdings or transactions, you can show which chain they're on:

```typescript
// NFTs include chainId and chainName
multichainNFTs.map(nft => (
  <div key={`${nft.chainId}-${nft.tokenId}`}>
    {nft.definition} ({nft.chainName})
  </div>
));

// Transactions include chainId and chainName
transactions.map(tx => (
  <div key={tx.id}>
    {tx.type} on {tx.chainName}
  </div>
));
```

## Network Configuration

Networks are configured in `app/src/config/networks.ts`. The multichain hooks automatically query all networks in `SUPPORTED_NETWORKS`:

```typescript
export const SUPPORTED_NETWORKS: NetworkConfig[] = [
  { chainId: 1, name: 'Ethereum Mainnet', ... },
  { chainId: 8453, name: 'Base', ... },
  { chainId: 11155111, name: 'Sepolia', ... },
  { chainId: 84532, name: 'Base Sepolia', ... },
];
```

## Performance Considerations

1. **Parallel Fetching**: All chains are queried in parallel for optimal performance
2. **Caching**: Data is cached and refreshed every 30 seconds
3. **Error Handling**: Individual chain failures don't block other chains
4. **Lazy Loading**: Only fetches data when wallet is connected

## Transaction Flow

When a user initiates a transaction:

1. The app determines which chain the contract is deployed on
2. If the user is not on that chain, `ensureChain()` is called
3. The wallet prompts the user to switch chains (if needed)
4. The transaction is executed on the correct chain
5. The user doesn't need to manually switch chains beforehand

## Best Practices

1. **Always use multichain hooks** for displaying aggregated data
2. **Use `ensureChain()` before write operations** to ensure the correct chain
3. **Show chain information** when displaying holdings or transactions
4. **Handle chain switching errors** gracefully (user might reject the switch)
5. **Cache chain-specific data** to avoid unnecessary RPC calls

## Future Enhancements

Potential improvements:

1. **Chain-specific filtering**: Allow users to filter by specific chains
2. **Cross-chain transfers**: Support for bridging assets between chains
3. **Chain preferences**: Remember user's preferred chain for transactions
4. **Optimistic updates**: Update UI immediately while transactions are pending
5. **Batch operations**: Execute multiple transactions across chains efficiently

## Troubleshooting

### Transactions failing to switch chains
- Ensure the network is properly configured in `networks.ts`
- Check that the wallet supports `wallet_switchEthereumChain`
- Verify RPC URLs are accessible

### Missing data from certain chains
- Check if contracts are deployed on that chain
- Verify RPC endpoints are working
- Check browser console for specific errors

### Performance issues
- Reduce the number of supported networks if needed
- Implement pagination for large datasets
- Consider using an indexer API instead of direct RPC calls
