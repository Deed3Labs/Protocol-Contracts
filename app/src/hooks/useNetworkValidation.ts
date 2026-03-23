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
    // For embedded wallets: treat AppKit embedded session as connected when account status is connected
    // For regular wallets: check if isConnected is true AND we have an address
    const isEmbeddedWalletConnected = Boolean(embeddedWalletInfo && status === 'connected');
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

  type EthereumRequest = (args: { method: string; params?: unknown[] }) => Promise<unknown>;

  const switchToSupportedNetwork = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('No wallet provider available');
    }

    const targetNetwork = SUPPORTED_NETWORKS.find((network) =>
      isNetworkSupportedAndDeployed(network.chainId)
    );

    if (!targetNetwork) {
      throw new Error('No supported network is configured for switching');
    }

    const request = (window.ethereum as { request?: EthereumRequest }).request;
    if (!request) {
      throw new Error('Wallet provider does not support JSON-RPC requests');
    }

    const targetChainHex = `0x${targetNetwork.chainId.toString(16)}`;

    try {
      await request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChainHex }],
      });
      return;
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 4902) {
        throw error;
      }
    }

    await request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: targetChainHex,
          chainName: targetNetwork.name,
          nativeCurrency: targetNetwork.nativeCurrency,
          rpcUrls: [targetNetwork.rpcUrl],
          blockExplorerUrls: targetNetwork.blockExplorer ? [targetNetwork.blockExplorer] : [],
        },
      ],
    });
  }, []);

  const getNetworkDisplayName = useCallback((chainId: number) => {
    const network = getNetworkByChainId(chainId);
    return network?.name || `Chain ID: ${chainId}`;
  }, []);

  // More accurate connection detection
  const isEmbeddedWalletConnected = Boolean(embeddedWalletInfo && status === 'connected');
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
