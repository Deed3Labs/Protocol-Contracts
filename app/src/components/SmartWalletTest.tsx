import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { useCapabilities } from '@/hooks/useCapabilities';
import { EIP5792Utils } from '@/utils/EIP5792Utils';
import { ethers } from 'ethers';

const SmartWalletTest = () => {
  const { address, isConnected, embeddedWalletInfo, status } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider("eip155");
  const { 
    capabilities, 
    isEIP5792Supported, 
    supportsAtomicBatch, 
    loading, 
    error, 
    refreshCapabilities 
  } = useCapabilities();

  const [testResults, setTestResults] = useState<{
    simpleCall: string | null;
    batchCall: string | null;
    error: string | null;
  }>({
    simpleCall: null,
    batchCall: null,
    error: null
  });

  const [isTesting, setIsTesting] = useState(false);

  // Test simple contract call
  const testSimpleCall = async () => {
    if (!walletProvider || !address) {
      setTestResults(prev => ({ ...prev, error: 'Wallet not connected' }));
      return;
    }

    setIsTesting(true);
    setTestResults({ simpleCall: null, batchCall: null, error: null });

    try {
      // Example: Call a simple view function (like balanceOf)
      const testAddress = '0x0000000000000000000000000000000000000000';
      const iface = new ethers.Interface(['function balanceOf(address owner) view returns (uint256)']);
      const data = iface.encodeFunctionData('balanceOf', [address]);

      const result = await EIP5792Utils.executeCall(
        walletProvider as any,
        testAddress,
        data,
        address
      );

      setTestResults(prev => ({ ...prev, simpleCall: result }));
    } catch (err) {
      setTestResults(prev => ({ 
        ...prev, 
        error: err instanceof Error ? err.message : 'Unknown error' 
      }));
    } finally {
      setIsTesting(false);
    }
  };

  // Test batch contract calls
  const testBatchCalls = async () => {
    if (!walletProvider || !address || !supportsAtomicBatch) {
      setTestResults(prev => ({ 
        ...prev, 
        error: supportsAtomicBatch ? 'Wallet not connected' : 'Atomic batch not supported' 
      }));
      return;
    }

    setIsTesting(true);
    setTestResults(prev => ({ ...prev, batchCall: null, error: null }));

    try {
      // Example: Multiple calls in a batch
      const testAddress = '0x0000000000000000000000000000000000000000';
      const balanceIface = new ethers.Interface(['function balanceOf(address owner) view returns (uint256)']);
      const nameIface = new ethers.Interface(['function name() view returns (string)']);
      const calls = [
        {
          to: testAddress,
          data: balanceIface.encodeFunctionData('balanceOf', [address])
        },
        {
          to: testAddress,
          data: nameIface.encodeFunctionData('name', [])
        }
      ];

      const result = await EIP5792Utils.executeBatchCalls(
        walletProvider as any,
        calls,
        address
      );

      setTestResults(prev => ({ 
        ...prev, 
        batchCall: `Batch executed: ${result.receipts.length} receipts` 
      }));
    } catch (err) {
      setTestResults(prev => ({ 
        ...prev, 
        error: err instanceof Error ? err.message : 'Unknown error' 
      }));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge variant="outline">Smart Wallet Test</Badge>
            Smart Account EIP-5792 Test
          </CardTitle>
          <CardDescription>
            Test EIP-5792 capabilities with your smart wallet
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Connection Status */}
          <div className="space-y-2">
            <h3 className="font-semibold">Connection Status</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Connected:</span>
                <Badge variant={isConnected ? "default" : "secondary"} className="ml-2">
                  {isConnected ? "Yes" : "No"}
                </Badge>
              </div>
              <div>
                <span className="text-gray-500">Smart Account:</span>
                <Badge variant={embeddedWalletInfo?.isSmartAccountDeployed ? "default" : "secondary"} className="ml-2">
                  {embeddedWalletInfo?.isSmartAccountDeployed ? "Deployed" : "Not Deployed"}
                </Badge>
              </div>
              <div>
                <span className="text-gray-500">Address:</span>
                <span className="ml-2 font-mono text-xs">
                  {address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : "None"}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>
                <Badge variant="outline" className="ml-2">{status}</Badge>
              </div>
            </div>
          </div>

          {/* EIP-5792 Capabilities */}
          <div className="space-y-2">
            <h3 className="font-semibold">EIP-5792 Capabilities</h3>
            {loading ? (
              <div className="text-sm text-gray-500">Loading capabilities...</div>
            ) : error ? (
              <div className="text-sm text-red-500">Error: {error}</div>
            ) : (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">EIP-5792 Supported:</span>
                  <Badge variant={isEIP5792Supported ? "default" : "secondary"} className="ml-2">
                    {isEIP5792Supported ? "Yes" : "No"}
                  </Badge>
                </div>
                <div>
                  <span className="text-gray-500">Atomic Batch:</span>
                  <Badge variant={supportsAtomicBatch ? "default" : "secondary"} className="ml-2">
                    {supportsAtomicBatch ? "Supported" : "Not Supported"}
                  </Badge>
                </div>
                {capabilities && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Capabilities:</span>
                    <pre className="mt-1 text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded">
                      {JSON.stringify(capabilities, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
            <Button 
              onClick={refreshCapabilities} 
              variant="outline" 
              size="sm"
              disabled={loading}
            >
              Refresh Capabilities
            </Button>
          </div>

          {/* Test Actions */}
          <div className="space-y-2">
            <h3 className="font-semibold">Test Actions</h3>
            <div className="flex gap-2">
              <Button 
                onClick={testSimpleCall} 
                disabled={!isConnected || isTesting}
                variant="outline"
              >
                Test Simple Call
              </Button>
              <Button 
                onClick={testBatchCalls} 
                disabled={!isConnected || !supportsAtomicBatch || isTesting}
                variant="outline"
              >
                Test Batch Calls
              </Button>
            </div>
          </div>

          {/* Test Results */}
          {testResults.simpleCall && (
            <div className="space-y-2">
              <h3 className="font-semibold">Simple Call Result</h3>
              <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded">
                {testResults.simpleCall}
              </pre>
            </div>
          )}

          {testResults.batchCall && (
            <div className="space-y-2">
              <h3 className="font-semibold">Batch Call Result</h3>
              <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded">
                {testResults.batchCall}
              </pre>
            </div>
          )}

          {testResults.error && (
            <div className="space-y-2">
              <h3 className="font-semibold text-red-600">Error</h3>
              <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                {testResults.error}
              </div>
            </div>
          )}

          {/* Usage Instructions */}
          <div className="space-y-2">
            <h3 className="font-semibold">Usage Instructions</h3>
            <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">
              <p>1. Connect your smart wallet (AppKit embedded wallet)</p>
              <p>2. Check if EIP-5792 capabilities are supported</p>
              <p>3. Test simple calls and batch calls</p>
              <p>4. Use the utilities in your components:</p>
              <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded mt-2">
{`// In your component:
import { EIP5792Utils } from '@/utils/EIP5792Utils';
import { useCapabilities } from '@/hooks/useCapabilities';

const { isEIP5792Supported, supportsAtomicBatch } = useCapabilities();

// For simple calls:
const result = await EIP5792Utils.executeCall(provider, address, data);

// For batch calls:
const result = await EIP5792Utils.executeBatchCalls(provider, calls);`}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SmartWalletTest; 