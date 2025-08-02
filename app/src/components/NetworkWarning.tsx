import React from 'react';
import { AlertTriangle, Construction } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useNetworkValidation } from '@/hooks/useNetworkValidation';
import { isNetworkSupported, isDeedNFTDeployed, getContractAddressForNetwork } from '@/config/networks';
import { useAppKitAccount } from '@reown/appkit/react';

export function NetworkWarning() {
  const { address } = useAppKitAccount();
  const {
    isConnected,
    chainId,
    isCorrectNetwork,
    currentNetwork,
    supportedNetworks,
    switchToSupportedNetwork,
    getNetworkDisplayName,
  } = useNetworkValidation();

  const [isSwitching, setIsSwitching] = React.useState(false);

  const handleSwitchNetwork = async () => {
    setIsSwitching(true);
    try {
      await switchToSupportedNetwork();
    } catch (error) {
      console.error('Failed to switch network:', error);
    } finally {
      setIsSwitching(false);
    }
  };

  if (!isConnected) {
    return null;
  }

  if (isCorrectNetwork) {
    const contractAddress = chainId ? getContractAddressForNetwork(chainId) : null;
    return (
      <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p className="text-blue-800 dark:text-blue-200 text-sm">
          <strong>Debug Info:</strong> Chain ID: {chainId}, Contract: {contractAddress || 'Not found'}, 
          Address: {address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : 'None'}
        </p>
        <p className="text-blue-700 dark:text-blue-300 text-xs mt-1">
          Connection Status: {isConnected ? 'Connected' : 'Disconnected'} | 
          Network: {isCorrectNetwork ? 'Correct' : 'Incorrect'} | 
          Network Name: {currentNetwork?.name || 'Unknown'}
        </p>
      </div>
    );
  }

  // Check if network is supported but contracts are not deployed
  const isSupportedButNotDeployed = chainId ? (isNetworkSupported(chainId) && !isDeedNFTDeployed(chainId)) : false;

  return (
    <Card className={`mb-4 ${
      isSupportedButNotDeployed 
        ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950'
        : 'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950'
    }`}>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 ${
          isSupportedButNotDeployed
            ? 'text-yellow-800 dark:text-yellow-200'
            : 'text-orange-800 dark:text-orange-200'
        }`}>
          {isSupportedButNotDeployed ? (
            <Construction className="h-5 w-5" />
          ) : (
            <AlertTriangle className="h-5 w-5" />
          )}
          {isSupportedButNotDeployed ? 'Contracts Not Deployed' : 'Wrong Network'}
        </CardTitle>
        <CardDescription className={
          isSupportedButNotDeployed
            ? 'text-yellow-700 dark:text-yellow-300'
            : 'text-orange-700 dark:text-orange-300'
        }>
          {isSupportedButNotDeployed 
            ? `You are connected to ${chainId ? getNetworkDisplayName(chainId) : 'unknown network'}, but the T-Deed contracts are not deployed yet. Please switch to a network with deployed contracts:`
            : `You are connected to ${chainId ? getNetworkDisplayName(chainId) : 'unknown network'}, but this app only supports the following networks:`
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {supportedNetworks.map((network) => (
            <Button
              key={network.chainId}
              variant="outline"
              size="sm"
              onClick={handleSwitchNetwork}
              disabled={isSwitching}
              className="w-full justify-start"
            >
              {isSwitching ? 'Switching...' : `Switch to ${network.name}`}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
} 