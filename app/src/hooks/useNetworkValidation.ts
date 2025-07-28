import { useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { useCallback, useEffect, useState } from 'react';
import { 
  getNetworkByChainId, 
  SUPPORTED_NETWORKS,
  isNetworkSupportedAndDeployed
} from '@/config/networks';

export function useNetworkValidation() {
  const { isConnected, embeddedWalletInfo, address, status } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  
  // Derive chainId from caipNetworkId
  const chainId = caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false);
  const [currentNetwork, setCurrentNetwork] = useState(chainId ? getNetworkByChainId(chainId) : undefined);
  const [isSmartAccountDeployed, setIsSmartAccountDeployed] = useState<boolean | null>(null);

  useEffect(() => {
    // More accurate connection detection
    // For embedded wallets: check if embeddedWalletInfo exists and has user data
    // For regular wallets: check if isConnected is true AND we have an address
    const isEmbeddedWalletConnected = Boolean(embeddedWalletInfo && embeddedWalletInfo.user && embeddedWalletInfo.user.email);
    const isRegularWalletConnected = Boolean(isConnected && address && status === 'connected');
    const isWalletConnected = isEmbeddedWalletConnected || isRegularWalletConnected;
    
    console.log("Connection Debug:", {
      isConnected,
      address,
      status,
      embeddedWalletInfo: embeddedWalletInfo ? {
        user: embeddedWalletInfo.user,
        accountType: embeddedWalletInfo.accountType,
        authProvider: embeddedWalletInfo.authProvider
      } : null,
      isEmbeddedWalletConnected,
      isRegularWalletConnected,
      isWalletConnected
    });
    
    if (isWalletConnected && chainId) {
      const network = getNetworkByChainId(chainId);
      setCurrentNetwork(network);
      // Check if network is supported AND has deployed contracts
      setIsCorrectNetwork(isNetworkSupportedAndDeployed(chainId));
      
      // Check smart account deployment status for embedded wallets
      if (embeddedWalletInfo) {
        setIsSmartAccountDeployed(embeddedWalletInfo.isSmartAccountDeployed);
        console.log("Smart Account Status:", {
          isDeployed: embeddedWalletInfo.isSmartAccountDeployed,
          accountType: embeddedWalletInfo.accountType,
          authProvider: embeddedWalletInfo.authProvider
        });
      } else {
        // For regular wallets, assume deployed
        setIsSmartAccountDeployed(true);
      }
    } else {
      setIsCorrectNetwork(false);
      setCurrentNetwork(undefined);
      setIsSmartAccountDeployed(null);
    }
  }, [isConnected, embeddedWalletInfo, address, status, chainId]);

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

  // More accurate connection detection
  const isEmbeddedWalletConnected = Boolean(embeddedWalletInfo && embeddedWalletInfo.user && embeddedWalletInfo.user.email);
  const isRegularWalletConnected = Boolean(isConnected && address && status === 'connected');
  const isWalletConnected = isEmbeddedWalletConnected || isRegularWalletConnected;
  
  // Check if smart account needs deployment
  const needsSmartAccountDeployment = embeddedWalletInfo && !embeddedWalletInfo.isSmartAccountDeployed;
  
  return {
    isConnected: isWalletConnected,
    chainId,
    isCorrectNetwork,
    currentNetwork,
    isSmartAccountDeployed,
    needsSmartAccountDeployment,
    embeddedWalletInfo,
    address,
    status,
    supportedNetworks: SUPPORTED_NETWORKS.filter(network => 
      isNetworkSupportedAndDeployed(network.chainId)
    ),
    switchToSupportedNetwork,
    getNetworkDisplayName,
  };
} 