# EIP-5792 Smart Account Integration

This implementation provides support for EIP-5792 wallet capabilities, enabling proper interaction with smart accounts (embedded wallets) in your dApp.

## Overview

The error `contract runner does not support calling (operation="call", code=UNSUPPORTED_OPERATION)` occurs because smart accounts don't support the standard `eth_call` method. Instead, they use EIP-5792 methods like `wallet_sendCalls` and `wallet_getCallsStatus`.

## Files Created

### 1. `app/src/utils/EIP5792Utils.ts`
Core utilities for EIP-5792 wallet interactions:
- `EIP5792Utils.executeCall()` - Execute single contract calls
- `EIP5792Utils.executeBatchCalls()` - Execute atomic batch transactions
- `EIP5792Utils.getWalletCapabilities()` - Check wallet capabilities
- `EIP5792Utils.supportsAtomicBatch()` - Check atomic batch support

### 2. `app/src/hooks/useCapabilities.ts`
React hook for managing wallet capabilities:
- `useCapabilities()` - Hook to check EIP-5792 support and capabilities

### 3. `app/src/hooks/useWagmiAvailableCapabilities.ts`
Fallback hook for wagmi integration:
- `useWagmiAvailableCapabilities()` - Hook for wagmi wallet capabilities

### 4. `app/src/components/SmartWalletTest.tsx`
Test component to demonstrate usage:
- Interactive testing of EIP-5792 capabilities
- Examples of simple and batch calls

## Usage

### Basic Usage

```typescript
import { EIP5792Utils } from '@/utils/EIP5792Utils';
import { useCapabilities } from '@/hooks/useCapabilities';

const MyComponent = () => {
  const { isEIP5792Supported, supportsAtomicBatch } = useCapabilities();
  
  const handleContractCall = async () => {
    try {
      // Single call
      const result = await EIP5792Utils.executeCall(
        walletProvider,
        contractAddress,
        encodedData
      );
      
      // Batch calls (if supported)
      if (supportsAtomicBatch) {
        const batchResult = await EIP5792Utils.executeBatchCalls(
          walletProvider,
          [
            { to: contract1, data: data1 },
            { to: contract2, data: data2 }
          ]
        );
      }
    } catch (error) {
      console.error('Call failed:', error);
    }
  };
};
```

### Updated Components

The following components have been updated to use EIP-5792:

1. **`app/src/context/DeedNFTContext.tsx`**
   - Updated `executeAppKitCall()` to use EIP-5792
   - Falls back to `eth_call` if EIP-5792 not supported

2. **`app/src/components/Validation.tsx`**
   - Updated `executeAppKitCall()` to use EIP-5792
   - Handles smart account contract interactions

3. **`app/src/components/AdminPanel.tsx`**
   - Updated `executeAppKitCall()` to use EIP-5792
   - Admin functions now work with smart accounts

## EIP-5792 Methods

### `wallet_getCapabilities`
Check what capabilities the wallet supports:
```typescript
const capabilities = await provider.request({
  method: 'wallet_getCapabilities',
  params: []
});
```

### `wallet_sendCalls`
Execute atomic batch transactions:
```typescript
const result = await provider.request({
  method: 'wallet_sendCalls',
  params: [{
    from: address,
    chainId: chainId,
    calls: [
      { to: contractAddress, data: encodedData }
    ],
    atomicRequired: true
  }]
});
```

### `wallet_getCallsStatus`
Get status of batch execution:
```typescript
const status = await provider.request({
  method: 'wallet_getCallsStatus',
  params: [batchId]
});
```

## Capability Values

- `atomic: "supported"` - Wallet supports atomic batch transactions
- `atomic: "ready"` - Wallet can upgrade to support atomic execution
- `atomic: "unsupported"` - Wallet doesn't support atomic execution

## Error Handling

The implementation includes comprehensive error handling:

1. **Graceful Fallback**: If EIP-5792 is not supported, falls back to standard `eth_call`
2. **Capability Detection**: Checks wallet capabilities before attempting calls
3. **Timeout Handling**: Waits for batch execution status with timeout
4. **Error Logging**: Detailed error messages for debugging

## Testing

Use the `SmartWalletTest` component to test your smart wallet:

1. Connect your AppKit embedded wallet
2. Check EIP-5792 capabilities
3. Test simple and batch calls
4. Verify results

## Integration with AppKit

The implementation is designed to work seamlessly with AppKit:

```typescript
import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { useCapabilities } from '@/hooks/useCapabilities';

const { walletProvider } = useAppKitProvider("eip155");
const { isEIP5792Supported } = useCapabilities();

// Use EIP-5792 if supported, otherwise fallback
if (isEIP5792Supported) {
  // Use EIP5792Utils.executeCall()
} else {
  // Use standard eth_call
}
```

## Troubleshooting

### Common Issues

1. **"contract runner does not support calling"**
   - Solution: Use EIP-5792 methods instead of `eth_call`
   - The implementation automatically handles this

2. **"Wallet does not support EIP-5792"**
   - Solution: Falls back to standard `eth_call`
   - Check if your wallet supports EIP-5792

3. **"Atomic batch not supported"**
   - Solution: Use single calls instead of batch calls
   - Check wallet capabilities first

### Debug Information

Enable debug logging to see detailed information:

```typescript
// In your component
console.log('Wallet capabilities:', capabilities);
console.log('EIP-5792 supported:', isEIP5792Supported);
console.log('Atomic batch supported:', supportsAtomicBatch);
```

## References

- [EIP-5792 Specification](https://eips.ethereum.org/EIPS/eip-5792)
- [AppKit Smart Accounts Documentation](https://docs.reown.com/appkit/react/core/smart-accounts)
- [AppKit Smart Accounts Interaction](https://docs.reown.com/appkit/react/core/smart-accounts-interaction)
- [ERC-4337 Account Abstraction](https://eips.ethereum.org/EIPS/eip-4337)

## Migration Guide

If you're updating existing code:

1. **Replace direct `eth_call` usage**:
   ```typescript
   // Old
   const result = await provider.request({
     method: 'eth_call',
     params: [{ to: address, data }, 'latest']
   });
   
   // New
   const result = await EIP5792Utils.executeCall(provider, address, data);
   ```

2. **Add capability checks**:
   ```typescript
   const { isEIP5792Supported } = useCapabilities();
   if (isEIP5792Supported) {
     // Use EIP-5792 methods
   } else {
     // Use standard methods
   }
   ```

3. **Update error handling**:
   ```typescript
   try {
     const result = await EIP5792Utils.executeCall(provider, address, data);
   } catch (error) {
     // Handle both EIP-5792 and standard errors
     console.error('Call failed:', error);
   }
   ```

This implementation ensures your dApp works seamlessly with both traditional wallets and smart accounts while providing the best user experience for each type. 