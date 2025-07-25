import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useCallback, useEffect, useState } from 'react';
import { isNetworkSupported, getNetworkByChainId, SUPPORTED_NETWORKS } from '@/config/networks';

export function useNetworkValidation() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false);
  const [currentNetwork, setCurrentNetwork] = useState(getNetworkByChainId(chainId));

  useEffect(() => {
    if (isConnected && chainId) {
      const network = getNetworkByChainId(chainId);
      setCurrentNetwork(network);
      setIsCorrectNetwork(isNetworkSupported(chainId));
    } else {
      setIsCorrectNetwork(false);
      setCurrentNetwork(undefined);
    }
  }, [isConnected, chainId]);

  const switchToSupportedNetwork = useCallback(async (targetChainId: number) => {
    try {
      await switchChain({ chainId: targetChainId });
    } catch (error) {
      console.error('Failed to switch network:', error);
      throw error;
    }
  }, [switchChain]);

  const getNetworkDisplayName = useCallback((chainId: number) => {
    const network = getNetworkByChainId(chainId);
    return network?.name || `Chain ID: ${chainId}`;
  }, []);

  return {
    isConnected,
    chainId,
    isCorrectNetwork,
    currentNetwork,
    supportedNetworks: SUPPORTED_NETWORKS,
    switchToSupportedNetwork,
    getNetworkDisplayName,
  };
} 