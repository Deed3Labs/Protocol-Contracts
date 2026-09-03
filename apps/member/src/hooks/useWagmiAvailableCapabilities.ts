import { useAccount } from 'wagmi';
import { useState, useEffect, useCallback } from 'react';
import { EIP5792Utils } from '@/utils/EIP5792Utils';
import type { WalletCapabilities } from '@/utils/EIP5792Utils';

export const useWagmiAvailableCapabilities = () => {
  const { connector } = useAccount();
  const [capabilities, setCapabilities] = useState<WalletCapabilities | null>(null);
  const [isEIP5792Supported, setIsEIP5792Supported] = useState<boolean>(false);
  const [supportsAtomicBatch, setSupportsAtomicBatch] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const checkCapabilities = useCallback(async () => {
    if (!connector) {
      setCapabilities(null);
      setIsEIP5792Supported(false);
      setSupportsAtomicBatch(false);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Try to get the provider from the connector
      const provider = await connector.getProvider();
      
      if (!provider) {
        throw new Error('No provider available from connector');
      }

      // Check if wallet supports EIP-5792
      const eip5792Supported = await EIP5792Utils.isEIP5792Supported(provider);
      setIsEIP5792Supported(eip5792Supported);

      if (eip5792Supported) {
        // Get wallet capabilities
        const walletCapabilities = await EIP5792Utils.getWalletCapabilities(provider);
        setCapabilities(walletCapabilities);

        // Check atomic batch support
        const atomicBatchSupported = await EIP5792Utils.supportsAtomicBatch(provider);
        setSupportsAtomicBatch(atomicBatchSupported);

        console.log('Wagmi wallet capabilities:', walletCapabilities);
        console.log('Atomic batch supported:', atomicBatchSupported);
      } else {
        setCapabilities(null);
        setSupportsAtomicBatch(false);
      }
    } catch (err) {
      console.error('Error checking wagmi wallet capabilities:', err);
      setError(err instanceof Error ? err.message : 'Failed to check wagmi wallet capabilities');
      setCapabilities(null);
      setIsEIP5792Supported(false);
      setSupportsAtomicBatch(false);
    } finally {
      setLoading(false);
    }
  }, [connector]);

  useEffect(() => {
    checkCapabilities();
  }, [checkCapabilities]);

  const refreshCapabilities = useCallback(() => {
    checkCapabilities();
  }, [checkCapabilities]);

  return {
    capabilities,
    isEIP5792Supported,
    supportsAtomicBatch,
    loading,
    error,
    refreshCapabilities
  };
}; 