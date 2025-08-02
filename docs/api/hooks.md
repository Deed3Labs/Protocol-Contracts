# Custom Hooks Documentation

This document provides comprehensive documentation for all custom hooks in The Deed Protocol frontend application, including their functionality, usage patterns, and integration with the protocol.

## 🎯 Overview

Custom hooks provide reusable logic for common operations in the frontend application, including authentication, data fetching, network validation, and smart account management.

## 📋 Hooks Overview

| Hook | Purpose | Size | Key Features |
|------|---------|------|--------------|
| **useAppKitAuth.ts** | Authentication and wallet management | 261 lines | Wallet connection, account management, network switching |
| **useNetworkValidation.ts** | Network validation and switching | 103 lines | Network detection, validation, switching |
| **useSmartAccountDeployment.ts** | Smart account deployment | 126 lines | Account deployment, configuration, status tracking |
| **useDeedNFTData.ts** | DeedNFT data fetching | 27 lines | Data fetching, caching, real-time updates |
| **useWagmiAvailableCapabilities.ts** | Wagmi capabilities | 80 lines | Capability detection, feature availability |
| **useCapabilities.ts** | AppKit capabilities | 73 lines | Capability management, feature detection |

## 🔧 Hook Details

### 1. useAppKitAuth.ts (261 lines)

Manages authentication state and wallet connections using Reowns AppKit.

#### Key Features

- **Wallet Connection**: Handle wallet connection and disconnection
- **Account Management**: Manage user accounts and switching
- **Network Switching**: Handle network changes and validation
- **Session Persistence**: Maintain user sessions across page reloads

#### Hook Interface

```typescript
interface UseAppKitAuthReturn {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  
  // Account information
  address: string | undefined;
  account: Account | undefined;
  accounts: Account[];
  
  // Connection functions
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  
  // Account management
  switchAccount: (account: Account) => Promise<void>;
  
  // Network management
  chain: Chain | undefined;
  chains: Chain[];
  switchChain: (chain: Chain) => Promise<void>;
  
  // Error handling
  error: Error | null;
  clearError: () => void;
}
```

#### Usage Example

```typescript
import { useAppKitAuth } from '@/hooks/useAppKitAuth';

function WalletConnection() {
  const { 
    isConnected, 
    address, 
    connect, 
    disconnect,
    switchAccount,
    accounts 
  } = useAppKitAuth();

  const handleConnect = async () => {
    try {
      await connect();
      console.log('Wallet connected successfully');
    } catch (error) {
      console.error('Connection failed:', error);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      console.log('Wallet disconnected successfully');
    } catch (error) {
      console.error('Disconnection failed:', error);
    }
  };

  return (
    <div>
      {isConnected ? (
        <div>
          <p>Connected: {address}</p>
          <button onClick={handleDisconnect}>Disconnect</button>
          
          {accounts.length > 1 && (
            <select onChange={(e) => switchAccount(accounts[e.target.value])}>
              {accounts.map((account, index) => (
                <option key={index} value={index}>
                  {account.address}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <button onClick={handleConnect}>Connect Wallet</button>
      )}
    </div>
  );
}
```

#### Key Functions

**Connection Management:**
```typescript
// Connect wallet
const connect = async (): Promise<void> => {
  try {
    setIsConnecting(true);
    await appKit.connect();
    setError(null);
  } catch (error) {
    setError(error as Error);
  } finally {
    setIsConnecting(false);
  }
};

// Disconnect wallet
const disconnect = async (): Promise<void> => {
  try {
    setIsDisconnecting(true);
    await appKit.disconnect();
    setError(null);
  } catch (error) {
    setError(error as Error);
  } finally {
    setIsDisconnecting(false);
  }
};
```

**Account Management:**
```typescript
// Switch between accounts
const switchAccount = async (account: Account): Promise<void> => {
  try {
    await appKit.switchAccount(account);
    setError(null);
  } catch (error) {
    setError(error as Error);
  }
};

// Get current account
const getCurrentAccount = (): Account | undefined => {
  return appKit.account;
};
```

**Network Management:**
```typescript
// Switch network
const switchChain = async (chain: Chain): Promise<void> => {
  try {
    await appKit.switchChain(chain);
    setError(null);
  } catch (error) {
    setError(error as Error);
  }
};

// Get current network
const getCurrentChain = (): Chain | undefined => {
  return appKit.chain;
};
```

### 2. useNetworkValidation.ts (103 lines)

Handles network validation and switching for the protocol.

#### Key Features

- **Network Detection**: Automatic network detection and validation
- **Supported Networks**: Validate against supported network list
- **Network Switching**: Facilitate network switching with validation
- **User Feedback**: Provide clear feedback for network issues

#### Hook Interface

```typescript
interface UseNetworkValidationReturn {
  // Network state
  isCorrectNetwork: boolean;
  currentNetwork: Network | null;
  supportedNetworks: Network[];
  
  // Network functions
  switchToSupportedNetwork: () => Promise<void>;
  validateNetwork: (chainId: number) => boolean;
  
  // Status
  isSwitching: boolean;
  error: string | null;
}
```

#### Usage Example

```typescript
import { useNetworkValidation } from '@/hooks/useNetworkValidation';

function NetworkStatus() {
  const { 
    isCorrectNetwork, 
    currentNetwork, 
    switchToSupportedNetwork,
    isSwitching,
    error 
  } = useNetworkValidation();

  return (
    <div>
      {isCorrectNetwork ? (
        <div className="text-green-600">
          Connected to {currentNetwork?.name}
        </div>
      ) : (
        <div className="text-red-600">
          <p>Please switch to a supported network</p>
          <button 
            onClick={switchToSupportedNetwork}
            disabled={isSwitching}
          >
            {isSwitching ? 'Switching...' : 'Switch Network'}
          </button>
          {error && <p className="text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
```

#### Key Functions

**Network Validation:**
```typescript
// Check if current network is supported
const validateNetwork = (chainId: number): boolean => {
  return supportedNetworks.some(network => network.chainId === chainId);
};

// Get supported networks
const getSupportedNetworks = (): Network[] => {
  return [
    { name: 'Base Sepolia', chainId: 84532, rpcUrl: 'https://sepolia.base.org' },
    { name: 'Ethereum Sepolia', chainId: 11155111, rpcUrl: 'https://rpc.sepolia.org' },
    // Add more supported networks
  ];
};
```

**Network Switching:**
```typescript
// Switch to supported network
const switchToSupportedNetwork = async (): Promise<void> => {
  try {
    setIsSwitching(true);
    setError(null);
    
    // Try to switch to the first supported network
    const targetNetwork = supportedNetworks[0];
    await switchChain(targetNetwork);
    
  } catch (error) {
    setError('Failed to switch network. Please switch manually.');
  } finally {
    setIsSwitching(false);
  }
};
```

### 3. useSmartAccountDeployment.ts (126 lines)

Manages smart account deployment and configuration.

#### Key Features

- **Account Deployment**: Handle smart account deployment
- **Configuration Management**: Manage account configuration
- **Gas Optimization**: Optimize deployment gas costs
- **Status Tracking**: Track deployment status and progress

#### Hook Interface

```typescript
interface UseSmartAccountDeploymentReturn {
  // Deployment state
  isSmartAccountDeployed: boolean;
  isDeploying: boolean;
  deploymentStatus: 'idle' | 'deploying' | 'success' | 'error';
  
  // Deployment functions
  deploySmartAccount: () => Promise<void>;
  checkDeploymentStatus: () => Promise<boolean>;
  
  // Configuration
  smartAccountAddress: string | null;
  deploymentError: string | null;
}
```

#### Usage Example

```typescript
import { useSmartAccountDeployment } from '@/hooks/useSmartAccountDeployment';

function SmartAccountSetup() {
  const { 
    isSmartAccountDeployed, 
    deploySmartAccount, 
    isDeploying,
    deploymentStatus,
    smartAccountAddress,
    deploymentError 
  } = useSmartAccountDeployment();

  const handleDeploy = async () => {
    try {
      await deploySmartAccount();
      console.log('Smart account deployed successfully');
    } catch (error) {
      console.error('Deployment failed:', error);
    }
  };

  return (
    <div>
      {!isSmartAccountDeployed ? (
        <div>
          <button 
            onClick={handleDeploy}
            disabled={isDeploying}
            className="bg-blue-500 text-white px-4 py-2 rounded"
          >
            {isDeploying ? 'Deploying...' : 'Deploy Smart Account'}
          </button>
          
          {deploymentError && (
            <p className="text-red-500 mt-2">{deploymentError}</p>
          )}
        </div>
      ) : (
        <div className="text-green-600">
          <p>Smart Account Deployed!</p>
          <p>Address: {smartAccountAddress}</p>
        </div>
      )}
      
      {deploymentStatus === 'deploying' && (
        <div className="mt-4">
          <p>Deploying smart account...</p>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-blue-600 h-2 rounded-full animate-pulse"></div>
          </div>
        </div>
      )}
    </div>
  );
}
```

#### Key Functions

**Deployment Management:**
```typescript
// Deploy smart account
const deploySmartAccount = async (): Promise<void> => {
  try {
    setIsDeploying(true);
    setDeploymentStatus('deploying');
    setDeploymentError(null);
    
    // Deploy smart account using AppKit
    const deployedAddress = await appKit.deploySmartAccount();
    
    setSmartAccountAddress(deployedAddress);
    setDeploymentStatus('success');
    
  } catch (error) {
    setDeploymentError(error.message);
    setDeploymentStatus('error');
  } finally {
    setIsDeploying(false);
  }
};

// Check deployment status
const checkDeploymentStatus = async (): Promise<boolean> => {
  try {
    const isDeployed = await appKit.isSmartAccountDeployed();
    setIsSmartAccountDeployed(isDeployed);
    return isDeployed;
  } catch (error) {
    console.error('Failed to check deployment status:', error);
    return false;
  }
};
```

### 4. useDeedNFTData.ts (27 lines)

Manages DeedNFT data fetching and caching.

#### Key Features

- **Data Fetching**: Efficient data fetching from smart contracts
- **Caching Strategy**: Intelligent caching for performance
- **Real-time Updates**: Live updates when blockchain state changes
- **Error Recovery**: Robust error handling and recovery

#### Hook Interface

```typescript
interface UseDeedNFTDataReturn {
  // Data state
  assets: DeedNFT[] | null;
  loading: boolean;
  error: string | null;
  
  // Data functions
  refetch: () => Promise<void>;
  getAssetById: (tokenId: string) => DeedNFT | null;
  
  // Pagination
  hasMore: boolean;
  loadMore: () => Promise<void>;
}
```

#### Usage Example

```typescript
import { useDeedNFTData } from '@/hooks/useDeedNFTData';

function AssetList() {
  const { 
    assets, 
    loading, 
    error, 
    refetch,
    hasMore,
    loadMore 
  } = useDeedNFTData();

  if (loading) return <div>Loading assets...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {assets?.map(asset => (
          <AssetCard key={asset.tokenId} asset={asset} />
        ))}
      </div>
      
      {hasMore && (
        <button 
          onClick={loadMore}
          className="mt-4 bg-blue-500 text-white px-4 py-2 rounded"
        >
          Load More
        </button>
      )}
      
      <button 
        onClick={refetch}
        className="mt-2 bg-gray-500 text-white px-4 py-2 rounded"
      >
        Refresh
      </button>
    </div>
  );
}
```

#### Key Functions

**Data Fetching:**
```typescript
// Fetch user assets
const fetchAssets = async (): Promise<void> => {
  try {
    setLoading(true);
    setError(null);
    
    const userAssets = await deedNFTContract.getUserAssets(userAddress);
    setAssets(userAssets);
    
  } catch (error) {
    setError('Failed to fetch assets');
    console.error('Asset fetch error:', error);
  } finally {
    setLoading(false);
  }
};

// Get specific asset
const getAssetById = (tokenId: string): DeedNFT | null => {
  return assets?.find(asset => asset.tokenId === tokenId) || null;
};
```

### 5. useWagmiAvailableCapabilities.ts (80 lines)

Detects and manages Wagmi capabilities for enhanced functionality.

#### Key Features

- **Capability Detection**: Detect available Wagmi capabilities
- **Feature Availability**: Check if specific features are available
- **Fallback Handling**: Provide fallbacks for unavailable features
- **Performance Optimization**: Optimize based on available capabilities

#### Hook Interface

```typescript
interface UseWagmiAvailableCapabilitiesReturn {
  // Capability state
  capabilities: WagmiCapabilities;
  isCapabilitiesLoaded: boolean;
  
  // Feature checks
  hasWalletConnect: boolean;
  hasMultiChain: boolean;
  hasBatchTransactions: boolean;
  hasSimulation: boolean;
  
  // Utility functions
  checkCapability: (capability: string) => boolean;
  getAvailableFeatures: () => string[];
}
```

#### Usage Example

```typescript
import { useWagmiAvailableCapabilities } from '@/hooks/useWagmiAvailableCapabilities';

function CapabilityAwareComponent() {
  const { 
    capabilities,
    hasWalletConnect,
    hasMultiChain,
    hasBatchTransactions,
    checkCapability 
  } = useWagmiAvailableCapabilities();

  return (
    <div>
      <h3>Available Features:</h3>
      <ul>
        {hasWalletConnect && <li>Wallet Connection</li>}
        {hasMultiChain && <li>Multi-Chain Support</li>}
        {hasBatchTransactions && <li>Batch Transactions</li>}
      </ul>
      
      {checkCapability('simulation') && (
        <div className="bg-green-100 p-2 rounded">
          Transaction simulation available
        </div>
      )}
    </div>
  );
}
```

### 6. useCapabilities.ts (73 lines)

Manages AppKit capabilities and feature detection.

#### Key Features

- **AppKit Integration**: Integrate with Reowns AppKit capabilities
- **Feature Detection**: Detect available AppKit features
- **Capability Management**: Manage and track capabilities
- **Performance Optimization**: Optimize based on available capabilities

#### Hook Interface

```typescript
interface UseCapabilitiesReturn {
  // Capability state
  capabilities: AppKitCapabilities;
  isCapabilitiesLoaded: boolean;
  
  // Feature checks
  hasSmartAccounts: boolean;
  hasEmbeddedWallet: boolean;
  hasEIP5792: boolean;
  hasMultiChain: boolean;
  
  // Utility functions
  checkCapability: (capability: string) => boolean;
  getCapabilityInfo: (capability: string) => CapabilityInfo | null;
}
```

#### Usage Example

```typescript
import { useCapabilities } from '@/hooks/useCapabilities';

function AppKitFeatures() {
  const { 
    capabilities,
    hasSmartAccounts,
    hasEmbeddedWallet,
    hasEIP5792,
    checkCapability 
  } = useCapabilities();

  return (
    <div>
      <h3>AppKit Features:</h3>
      <ul>
        {hasSmartAccounts && <li>Smart Accounts</li>}
        {hasEmbeddedWallet && <li>Embedded Wallet</li>}
        {hasEIP5792 && <li>EIP-5792 Support</li>}
      </ul>
      
      {checkCapability('batchTransactions') && (
        <div className="bg-blue-100 p-2 rounded">
          Batch transactions supported
        </div>
      )}
    </div>
  );
}
```

## 🔄 Hook Integration Patterns

### Authentication Flow

```typescript
// Combine authentication and network validation
function useAuthenticatedApp() {
  const auth = useAppKitAuth();
  const network = useNetworkValidation();
  const capabilities = useCapabilities();
  
  return {
    ...auth,
    ...network,
    ...capabilities,
    isReady: auth.isConnected && network.isCorrectNetwork,
    canInteract: auth.isConnected && network.isCorrectNetwork && capabilities.hasSmartAccounts
  };
}
```

### Data Fetching with Authentication

```typescript
// Combine authentication with data fetching
function useAuthenticatedData() {
  const auth = useAppKitAuth();
  const data = useDeedNFTData();
  
  useEffect(() => {
    if (auth.isConnected && auth.address) {
      data.refetch();
    }
  }, [auth.isConnected, auth.address]);
  
  return {
    ...data,
    isAuthenticated: auth.isConnected,
    userAddress: auth.address
  };
}
```

## 🚨 Error Handling

### Hook Error Patterns

```typescript
// Standard error handling pattern
const useHookWithErrorHandling = () => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  const executeWithErrorHandling = async (operation: () => Promise<void>) => {
    try {
      setLoading(true);
      setError(null);
      await operation();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  return { error, loading, executeWithErrorHandling };
};
```

### Error Recovery

```typescript
// Automatic error recovery
const useAutoRecovery = (retryCount = 3) => {
  const [retries, setRetries] = useState(0);
  
  const executeWithRetry = async (operation: () => Promise<void>) => {
    try {
      await operation();
      setRetries(0); // Reset on success
    } catch (error) {
      if (retries < retryCount) {
        setRetries(retries + 1);
        setTimeout(() => executeWithRetry(operation), 1000 * retries);
      }
    }
  };
  
  return { executeWithRetry, retries };
};
```

## 📊 Performance Optimization

### Hook Optimization Patterns

```typescript
// Memoized hook results
const useOptimizedHook = (dependencies: any[]) => {
  const result = useMemo(() => {
    // Expensive computation
    return computeResult(dependencies);
  }, dependencies);
  
  return result;
};

// Debounced operations
const useDebouncedHook = (delay = 300) => {
  const [value, setValue] = useState(null);
  const debouncedSetValue = useCallback(
    debounce(setValue, delay),
    [delay]
  );
  
  return { value, setValue: debouncedSetValue };
};
```

### Caching Strategies

```typescript
// Simple caching hook
const useCachedData = <T>(key: string, fetcher: () => Promise<T>) => {
  const [cache, setCache] = useState<Record<string, T>>({});
  
  const getData = useCallback(async () => {
    if (cache[key]) return cache[key];
    
    const data = await fetcher();
    setCache(prev => ({ ...prev, [key]: data }));
    return data;
  }, [key, fetcher, cache]);
  
  return { getData, cachedData: cache[key] };
};
```

## 🔧 Development Guidelines

### Hook Best Practices

1. **Single Responsibility**
   - Each hook should have a single, clear purpose
   - Avoid mixing concerns in one hook
   - Keep hooks focused and composable

2. **Error Handling**
   - Always handle errors gracefully
   - Provide meaningful error messages
   - Include error recovery mechanisms

3. **Performance**
   - Use memoization for expensive operations
   - Implement proper cleanup in useEffect
   - Avoid unnecessary re-renders

4. **TypeScript**
   - Use proper TypeScript types
   - Define clear interfaces
   - Provide good IntelliSense support

### Testing Hooks

```typescript
// Testing custom hooks
import { renderHook, act } from '@testing-library/react-hooks';

describe('useAppKitAuth', () => {
  it('should connect wallet successfully', async () => {
    const { result } = renderHook(() => useAppKitAuth());
    
    await act(async () => {
      await result.current.connect();
    });
    
    expect(result.current.isConnected).toBe(true);
  });
});
```

---

*This documentation is part of The Deed Protocol v0.2.0-beta. For questions about custom hooks, please contact the development team.* 