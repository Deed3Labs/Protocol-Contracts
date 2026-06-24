import React, { useState, useEffect } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { useNetworkValidation } from '@/hooks/useNetworkValidation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  url: string;
}

const Modal = ({ isOpen, onClose, title, url }: ModalProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-5xl h-[85vh] bg-white dark:bg-[#141414] rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414]">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Iframe Container */}
        <div className="h-full w-full">
          <iframe
            src={url}
            className="w-full h-full border-0"
            title={title}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      </div>
    </div>
  );
};

const Faucet: React.FC = () => {
  const { address, isConnected } = useAppKitAccount();
  const { chainId, switchToSupportedNetwork } = useNetworkValidation();
  
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [ethAmount, setEthAmount] = useState('0.01');
  const [usdcAmount, setUsdcAmount] = useState('10');
  // const [lastRequestTime, setLastRequestTime] = useState<number>(0); // DISABLED: Rate limiting is disabled
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    title: string;
    url: string;
  }>({
    isOpen: false,
    title: '',
    url: ''
  });

  const baseSepoliaChainId = 84532;
  const isBaseSepolia = chainId === baseSepoliaChainId;

  // Base Sepolia faucet endpoints - using reliable third-party faucets
  const FAUCET_ENDPOINTS = {
    ETH: 'https://thirdweb.com/base-sepolia-testnet',
    USDC: 'https://faucet.circle.com/'
  };

  const handleSwitchNetwork = async () => {
    try {
      await switchToSupportedNetwork();
    } catch (error) {
      console.error('Failed to switch network:', error);
      setMessage({ type: 'error', text: 'Please switch to Base Sepolia network through your wallet or AppKit modal' });
    }
  };

  const requestTokens = async (tokenType: 'ETH' | 'USDC') => {
    if (!address) {
      setMessage({ type: 'error', text: 'Please connect your wallet first' });
      return;
    }

    if (!isBaseSepolia) {
      setMessage({ type: 'error', text: 'Please switch to Base Sepolia network first' });
      return;
    }

    // Rate limiting: prevent requests more than once per 30 seconds
    // DISABLED: Since we're opening external links, rate limiting is not needed
    // const now = Date.now();
    // if (now - lastRequestTime < 30000) {
    //   setMessage({ type: 'error', text: 'Please wait 30 seconds between requests' });
    //   return;
    // }

    setIsLoading(true);
    setMessage(null);

    try {
      // For Base Sepolia, we'll open the official faucet in a modal
      const faucetUrl = FAUCET_ENDPOINTS[tokenType];
      const title = tokenType === 'ETH' ? 'Thirdweb Sepolia ETH Faucet' : 'Circle USDC Faucet';
      openModal(title, faucetUrl);
      
      setMessage({ 
        type: 'success', 
        text: `Opening ${tokenType} faucet in modal. Please paste your address: ${address}` 
      });
      // setLastRequestTime(now); // DISABLED: Rate limiting is disabled
    } catch (error) {
      console.error(`Error opening faucet:`, error);
      setMessage({ type: 'error', text: `Failed to open faucet. Please try again.` });
    } finally {
      setIsLoading(false);
    }
  };

  const openModal = (title: string, url: string) => {
    setModalState({
      isOpen: true,
      title,
      url
    });
  };

  const closeModal = () => {
    setModalState(prev => ({ ...prev, isOpen: false }));
  };

  const openExternalFaucet = () => {
    openModal('Base Chain Official Website', 'https://base.org');
  };

  const openBlockExplorer = () => {
    if (address) {
      openModal('Block Explorer', `https://base-sepolia.blockscout.com/address/${address}`);
    }
  };

  useEffect(() => {
    if (!isConnected) {
      setMessage({ type: 'info', text: 'Please connect your wallet to use the faucet' });
    } else if (!isBaseSepolia) {
      setMessage({ type: 'info', text: 'Please switch to Base Sepolia network to use the faucet' });
    } else {
      setMessage(null);
    }
  }, [isConnected, isBaseSepolia]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-5xl lg:text-6xl font-bold font-coolvetica">BASE SEPOLIA FAUCET</h1>
          <p className="text-lg text-muted-foreground">
            Get testnet ETH and USDC tokens for testing the Deed Protocol
          </p>
          <Badge variant="secondary" className="text-sm rounded-full dark:bg-[#141414] border border-black/10 dark:border-white/10">
            Chain ID: {baseSepoliaChainId}
          </Badge>
        </div>

        {/* Network Status */}
        <Card className="dark:bg-[#141414]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Network Status
              {isBaseSepolia ? (
                <Badge variant="default" className="bg-green-500 rounded-full border border-black/10 dark:border-white/10">Connected</Badge>
              ) : (
                <Badge variant="destructive" className="rounded-full border border-black/10 dark:border-white/10">Wrong Network</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span>Current Network:</span>
                <span className="font-mono">{chainId ? `Chain ID: ${chainId}` : 'Not Connected'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Chain ID:</span>
                <span className="font-mono">{chainId || 'N/A'}</span>
              </div>
              {address && (
                <div className="flex justify-between items-center">
                  <span>Wallet Address:</span>
                  <span className="font-mono text-sm">{address.slice(0, 6)}...{address.slice(-4)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Network Switch */}
        {!isBaseSepolia && isConnected && (
          <Card className="dark:bg-[#141414]">
            <CardHeader>
              <CardTitle>Switch to Base Sepolia</CardTitle>
              <CardDescription>
                You need to be on Base Sepolia testnet to use this faucet
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleSwitchNetwork} className="w-full">
                Switch to Base Sepolia
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Messages */}
        {message && (
          <Alert className={message.type === 'error' ? 'border-red-500' : message.type === 'success' ? 'border-green-500' : 'border-blue-500'}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        {/* Faucet Interface */}
        {isConnected && isBaseSepolia && (
          <div className="grid gap-6 md:grid-cols-2">
            {/* ETH Faucet */}
            <Card className="dark:bg-[#141414]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  ETH Faucet
                  <Badge variant="outline" className="rounded-full border border-black/10 dark:border-white/10">Base Sepolia</Badge>
                </CardTitle>
                <CardDescription>
                  Get 0.01 ETH/day from Base Sepolia faucet
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="eth-amount">Amount (ETH)</Label>
                  <Input
                    id="eth-amount"
                    type="number"
                    value={ethAmount}
                    onChange={(e) => setEthAmount(e.target.value)}
                    placeholder="0.01"
                    step="0.01"
                    min="0.001"
                    max="0.1"
                  />
                </div>
                <Button 
                  onClick={() => requestTokens('ETH')} 
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? 'Opening...' : 'Open ETH Faucet'}
                </Button>
              </CardContent>
            </Card>

            {/* USDC Faucet */}
            <Card className="dark:bg-[#141414]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  USDC Faucet
                  <Badge variant="outline" className="rounded-full border border-black/10 dark:border-white/10">Base Sepolia</Badge>
                </CardTitle>
                <CardDescription>
                  Get 10 USDC/hour from Circle faucet
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="usdc-amount">Amount (USDC)</Label>
                  <Input
                    id="usdc-amount"
                    type="number"
                    value={usdcAmount}
                    onChange={(e) => setUsdcAmount(e.target.value)}
                    placeholder="10"
                    step="1"
                    min="1"
                    max="1000"
                  />
                </div>
                <Button 
                  onClick={() => requestTokens('USDC')} 
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? 'Opening...' : 'Open USDC Faucet'}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        <Separator />

        {/* Additional Resources */}
        <Card className="dark:bg-[#141414]">
          <CardHeader>
            <CardTitle>Additional Resources</CardTitle>
            <CardDescription>
              Useful links for Base Sepolia testnet
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Button variant="outline" onClick={openExternalFaucet} className="w-full">
                Base Chain Official Website
              </Button>
              <Button variant="outline" onClick={openBlockExplorer} className="w-full">
                View on Block Explorer
              </Button>
            </div>
            
                         <div className="space-y-2 text-sm text-muted-foreground">
               <h4 className="font-semibold">Important Notes:</h4>
               <ul className="list-disc list-inside space-y-1">
                 <li>This faucet is for Base Sepolia testnet only</li>
                 <li>Tokens are for testing purposes and have no real value</li>
                 <li><strong>ETH:</strong> 0.01 ETH per day from Thirdweb faucet</li>
                 <li><strong>USDC:</strong> 10 USDC per hour from Circle faucet</li>
                 <li>Rate limiting applies: one request per 30 seconds</li>
                 <li>Select "Base Sepolia" network in Circle faucet for USDC</li>
               </ul>
             </div>
          </CardContent>
        </Card>

        {/* Network Information */}
        <Card className="dark:bg-[#141414]">
          <CardHeader>
            <CardTitle>Base Sepolia Network Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 text-sm">
              <div>
                <strong>Chain ID:</strong> 84532
              </div>
              <div>
                <strong>RPC URL:</strong> https://sepolia.base.org
              </div>
              <div>
                <strong>Block Explorer:</strong> https://base-sepolia.blockscout.com
              </div>
              <div>
                <strong>Currency:</strong> ETH (Sepolia Ether)
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Modal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        title={modalState.title}
        url={modalState.url}
      />
    </div>
  );
};

export default Faucet; 