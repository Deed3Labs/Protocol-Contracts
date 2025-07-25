import React from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useNetworkValidation } from '@/hooks/useNetworkValidation';

export function NetworkWarning() {
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

  const handleSwitchNetwork = async (targetChainId: number) => {
    setIsSwitching(true);
    try {
      await switchToSupportedNetwork(targetChainId);
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
    return (
      <Alert className="mb-4 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
        <AlertTitle className="text-green-800 dark:text-green-200">Connected to supported network</AlertTitle>
        <AlertDescription className="text-green-700 dark:text-green-300">
          You are connected to {currentNetwork?.name}. You can now mint NFTs.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="mb-4 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
          <AlertTriangle className="h-5 w-5" />
          Wrong Network
        </CardTitle>
        <CardDescription className="text-orange-700 dark:text-orange-300">
          You are connected to {getNetworkDisplayName(chainId)}, but this app only supports the following networks:
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {supportedNetworks.map((network) => (
            <Button
              key={network.chainId}
              variant="outline"
              size="sm"
              onClick={() => handleSwitchNetwork(network.chainId)}
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