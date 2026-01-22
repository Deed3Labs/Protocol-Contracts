/**
 * Base hook for multichain data fetching
 * Provides common functionality to reduce duplication across multichain hooks
 */

import { useState, useCallback, useRef } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { SUPPORTED_NETWORKS } from '@/config/networks';
import { 
  fetchWithDeviceOptimization,
  handleMultichainError 
} from './multichainHelpers';

export interface BaseMultichainOptions<T> {
  /**
   * Function to fetch data for a specific chain
   */
  fetchChainData: (chainId: number) => Promise<T[]>;
  
  /**
   * Function to transform chain data (optional)
   */
  transformChainData?: (data: T[], chainId: number) => T[];
  
  /**
   * Whether the hook is enabled (default: true)
   */
  enabled?: boolean;
  
  /**
   * Custom error handler (optional)
   */
  onError?: (error: Error, chainId: number, chainName: string) => void;
  
  /**
   * Whether to suppress error logging (default: true)
   */
  silentErrors?: boolean;
}

export interface BaseMultichainReturn<T> {
  /**
   * Array of data items across all chains
   */
  data: T[];
  
  /**
   * Whether data is currently loading
   */
  isLoading: boolean;
  
  /**
   * Error message, if any
   */
  error: string | null;
  
  /**
   * Refresh all chains
   */
  refresh: () => Promise<void>;
  
  /**
   * Refresh a specific chain
   */
  refreshChain: (chainId: number) => Promise<void>;
}

/**
 * Base hook for multichain data fetching
 * Handles common patterns like mobile/desktop optimization, error handling, and state management
 */
export function useBaseMultichain<T extends { chainId?: number }>(
  options: BaseMultichainOptions<T>
): BaseMultichainReturn<T> {
  const { address, isConnected } = useAppKitAccount();
  const {
    fetchChainData,
    transformChainData,
    enabled = true,
    onError,
    silentErrors = true,
  } = options;

  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track if we're refreshing to prevent state resets
  const isRefreshingRef = useRef(false);

  // Fetch data for a specific chain
  const fetchChain = useCallback(async (chainId: number): Promise<T[]> => {
    if (!address || !enabled) return [];

    const networkConfig = SUPPORTED_NETWORKS.find(n => n.chainId === chainId);
    if (!networkConfig) return [];

    try {
      const chainData = await fetchChainData(chainId);
      const transformedData = transformChainData 
        ? transformChainData(chainData, chainId)
        : chainData;
      
      // Ensure chainId is set on each item
      return transformedData.map(item => ({
        ...item,
        chainId,
      })) as T[];
    } catch (err) {
      // Handle error (logging is done inside handleMultichainError)
      handleMultichainError(
        err,
        chainId,
        networkConfig.name,
        silentErrors
      );
      
      if (onError && err instanceof Error) {
        onError(err, chainId, networkConfig.name);
      }
      
      // Return empty array on error (silent failure)
      return [];
    }
  }, [address, enabled, fetchChainData, transformChainData, onError, silentErrors]);

  // Refresh a specific chain
  const refreshChain = useCallback(async (chainId: number) => {
    if (!isConnected || !address || !enabled) return;

    // Update state optimistically
    setData(prev => {
      const updated = [...prev];
      const index = updated.findIndex(item => item.chainId === chainId);
      if (index >= 0) {
        // Mark as loading if item has isLoading property
        const item = updated[index] as any;
        if ('isLoading' in item) {
          updated[index] = { ...item, isLoading: true, error: null } as T;
        }
      }
      return updated;
    });

    try {
      const chainData = await fetchChain(chainId);
      setData(prev => {
        // Remove old data from this chain and add new data
        const filtered = prev.filter(item => item.chainId !== chainId);
        return [...filtered, ...chainData];
      });
    } catch (err) {
      const networkConfig = SUPPORTED_NETWORKS.find(n => n.chainId === chainId);
      const errorMessage = handleMultichainError(
        err,
        chainId,
        networkConfig?.name || `Chain ${chainId}`,
        silentErrors
      );
      
      setData(prev => {
        const updated = [...prev];
        const index = updated.findIndex(item => item.chainId === chainId);
        if (index >= 0) {
          const item = updated[index] as any;
          if ('isLoading' in item && 'error' in item) {
            updated[index] = { 
              ...item, 
              isLoading: false, 
              error: errorMessage 
            } as T;
          }
        }
        return updated;
      });
    }
  }, [isConnected, address, enabled, fetchChain, silentErrors]);

  // Refresh all chains
  const refresh = useCallback(async () => {
    if (!isConnected || !address || !enabled) {
      setData([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    isRefreshingRef.current = true;
    setIsLoading(true);
    setError(null);

    // Don't reset data to empty during refresh - keep existing data and mark as loading
    setData(prev => {
      if (prev.length > 0) {
        // Mark existing items as loading if they support it
        return prev.map(item => {
          const itemAny = item as any;
          if ('isLoading' in itemAny) {
            return { ...item, isLoading: true } as T;
          }
          return item;
        });
      }
      // Only initialize to empty if we don't have any data yet
      return [];
    });

    try {
      // Use device-optimized fetching (sequential for mobile, parallel for desktop)
      const allData = await fetchWithDeviceOptimization(
        SUPPORTED_NETWORKS,
        async (network) => {
          try {
            return await fetchChain(network.chainId);
          } catch (err) {
            // Individual chain errors are handled in fetchChain
            return [];
          }
        }
      );

      setData(allData);
    } catch (err) {
      const errorMessage = err instanceof Error 
        ? err.message 
        : 'Failed to fetch data';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      isRefreshingRef.current = false;
    }
  }, [isConnected, address, enabled, fetchChain]);

  return {
    data,
    isLoading,
    error,
    refresh,
    refreshChain,
  };
}
