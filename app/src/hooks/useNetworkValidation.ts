import { useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { useCallback, useEffect, useState } from 'react';
import { 
  getNetworkByChainId, 
  SUPPORTED_NETWORKS,
  isNetworkSupportedAndDeployed
} from '@/config/networks';

export function useNetworkValidation() {
  const { isConnected, embeddedWalletInfo } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  
  // Derive chainId from caipNetworkId
  const chainId = caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false);
  const [currentNetwork, setCurrentNetwork] = useState(chainId ? getNetworkByChainId(chainId) : undefined);

  useEffect(() => {
    // Check if connected (either regular wallet or embedded wallet)
    const isWalletConnected = isConnected || (embeddedWalletInfo !== null);
    
    if (isWalletConnected && chainId) {
      const network = getNetworkByChainId(chainId);
      setCurrentNetwork(network);
      // Check if network is supported AND has deployed contracts
      setIsCorrectNetwork(isNetworkSupportedAndDeployed(chainId));
    } else {
      setIsCorrectNetwork(false);
      setCurrentNetwork(undefined);
    }
  }, [isConnected, embeddedWalletInfo, chainId]);

  // Note: AppKit doesn't have a direct switchChain equivalent
  // Users will need to switch networks through their wallet or AppKit modal
  const switchToSupportedNetwork = useCallback(async () => {
    console.warn('Network switching is not directly supported by AppKit. Please switch networks through your wallet or AppKit modal.');
    throw new Error('Network switching not supported in AppKit mode. Please switch networks through your wallet.');
  }, []);

  const getNetworkDisplayName = useCallback((chainId: number) => {
    const network = getNetworkByChainId(chainId);
    return network?.name || `Chain ID: ${chainId}`;
  }, []);

  // Check if connected (either regular wallet or embedded wallet)
  const isWalletConnected = isConnected || (embeddedWalletInfo !== null);
  
  return {
    isConnected: isWalletConnected,
    chainId,
    isCorrectNetwork,
    currentNetwork,
    supportedNetworks: SUPPORTED_NETWORKS.filter(network => 
      isNetworkSupportedAndDeployed(network.chainId)
    ),
    switchToSupportedNetwork,
    getNetworkDisplayName,
  };
} 