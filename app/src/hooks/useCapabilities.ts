import { useState, useEffect, useCallback } from 'react';
import { useAppKitProvider } from '@reown/appkit/react';
import { EIP5792Utils } from '@/utils/EIP5792Utils';
import type { WalletCapabilities } from '@/utils/EIP5792Utils';

export const useCapabilities = () => {
  const { walletProvider } = useAppKitProvider("eip155");
  const [capabilities, setCapabilities] = useState<WalletCapabilities | null>(null);
  const [isEIP5792Supported, setIsEIP5792Supported] = useState<boolean>(false);
  const [supportsAtomicBatch, setSupportsAtomicBatch] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const checkCapabilities = useCallback(async () => {
    if (!walletProvider) {
      setCapabilities(null);
      setIsEIP5792Supported(false);
      setSupportsAtomicBatch(false);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Check if wallet supports EIP-5792
      const eip5792Supported = await EIP5792Utils.isEIP5792Supported(walletProvider);
      setIsEIP5792Supported(eip5792Supported);

      if (eip5792Supported) {
        // Get wallet capabilities
        const walletCapabilities = await EIP5792Utils.getWalletCapabilities(walletProvider);
        setCapabilities(walletCapabilities);

        // Check atomic batch support
        const atomicBatchSupported = await EIP5792Utils.supportsAtomicBatch(walletProvider);
        setSupportsAtomicBatch(atomicBatchSupported);

        console.log('Wallet capabilities:', walletCapabilities);
        console.log('Atomic batch supported:', atomicBatchSupported);
      } else {
        setCapabilities(null);
        setSupportsAtomicBatch(false);
      }
    } catch (err) {
      console.error('Error checking wallet capabilities:', err);
      setError(err instanceof Error ? err.message : 'Failed to check wallet capabilities');
      setCapabilities(null);
      setIsEIP5792Supported(false);
      setSupportsAtomicBatch(false);
    } finally {
      setLoading(false);
    }
  }, [walletProvider]);

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