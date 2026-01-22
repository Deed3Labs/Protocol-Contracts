import { useState } from 'react';
import { useAppKitAccount, useAppKitProvider, useAppKitNetwork } from '@reown/appkit/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Coins, Plus, Unlock, TrendingUp, CheckCircle, AlertCircle, RefreshCw, Maximize2, Minimize2, X } from 'lucide-react';
import { ethers } from 'ethers';
import { getContractAddressForNetwork, getAbiPathForNetwork } from '@/config/networks';
import type { DeedNFT } from '@/hooks/useDeedNFTData';

interface FractionalizeModalProps {
  deedNFT: DeedNFT;
  isOpen: boolean;
  onClose: () => void;
  getAssetTypeLabel: (assetType: number) => string;
  getValidationStatus: (deedNFT: DeedNFT) => { status: string; color: string };
}

// Dynamic ABI loading function for Fractionalize contract
const getFractionalizeAbi = async (chainId: number) => {
  try {
    const abiPath = getAbiPathForNetwork(chainId, 'Fractionalize');
    const abiModule = await import(abiPath);
    return JSON.parse(abiModule.default.abi);
  } catch (error) {
    console.error('Error loading Fractionalize ABI:', error);
    // Fallback to base-sepolia
    const fallbackModule = await import('@/contracts/base-sepolia/Fractionalize.json');
    return JSON.parse(fallbackModule.default.abi);
  }
};

const FractionalizeModal = ({ deedNFT, isOpen, onClose, getAssetTypeLabel, getValidationStatus }: FractionalizeModalProps) => {
  const { 
    address, 
    isConnected: isAppKitConnected,
    embeddedWalletInfo,
    status 
  } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider("eip155");
  const { chainId: rawChainId } = useAppKitNetwork();
  const chainId = typeof rawChainId === 'string' ? parseInt(rawChainId) : rawChainId;
  
  // Use AppKit connection state - handle both regular wallets and embedded wallets
  const isWalletConnected = isAppKitConnected || (embeddedWalletInfo && status === 'connected');
  
  
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('create');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isFullPage, setIsFullPage] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Clear messages when modal closes or tab changes
  const clearMessages = () => {
    setError(null);
    setSuccess(false);
    setTxHash(null);
  };

  // Wait for transaction receipt to check execution status
  const waitForTransactionReceipt = async (txHash: string) => {
    if (!walletProvider) throw new Error('No wallet provider available');
    
    let attempts = 0;
    while (attempts < 60) { // Wait up to 5 minutes
      try {
        const receipt = await (walletProvider as any).request({
          method: 'eth_getTransactionReceipt',
          params: [txHash]
        });
        if (receipt && receipt.blockNumber) {
          return receipt;
        }
      } catch (error) {
        console.log('Waiting for transaction receipt...', attempts);
      }
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      attempts++;
    }
    throw new Error('Transaction receipt timeout');
  };

  // Parse transaction error to get specific error message
  const parseTransactionError = async (txHash: string) => {
    try {
      if (!walletProvider) return 'Unknown error';
      
      // Try to get the transaction details to see if we can extract error info
      const tx = await (walletProvider as any).request({
        method: 'eth_getTransactionByHash',
        params: [txHash]
      });
      
      if (tx && tx.blockNumber) {
        // Transaction was included but failed - check common Fractionalize.sol error conditions
        return 'The fraction could not be created. Common causes: Asset not validated, insufficient ownership, or invalid parameters.';
      }
      
      return 'Transaction failed - please check that the asset is validated and you own it.';
    } catch (error) {
      console.error('Error parsing transaction error:', error);
      return 'Transaction failed - please check that the asset is validated and you own it.';
    }
  };
  
  // Form states
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    symbol: '',
    collectionUri: '',
    totalShares: '',
    approvalPercentage: '75',
    burnable: true,
  });

  const [mintForm, setMintForm] = useState({
    fractionId: '',
    amount: '',
    recipient: '',
  });

  const [unlockForm, setUnlockForm] = useState({
    fractionId: '',
    recipient: '',
    checkApprovals: true,
  });

  // Helper function to handle AppKit transactions
  const executeAppKitTransaction = async (
    contractAddress: string,
    abi: any,
    functionName: string,
    params: any[]
  ) => {
    if (!walletProvider) {
      throw new Error("Wallet provider not available");
    }

    console.log(`Executing AppKit transaction: ${functionName}`, {
      contractAddress,
      params
    });

    const data = new ethers.Interface(abi).encodeFunctionData(functionName, params);
    
    if (embeddedWalletInfo) {
      // For embedded wallets, use AppKit transaction system
      console.log("Using AppKit transaction for embedded wallet");
      const tx = await (walletProvider as any).request({
        method: 'eth_sendTransaction',
        params: [{
          to: contractAddress,
          data
        }]
      });
      console.log("AppKit transaction executed successfully:", tx);
      return tx;
    } else {
      // For regular wallets, use standard transaction with from field
      console.log("Using standard transaction for regular wallet");
      const tx = await (walletProvider as any).request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: contractAddress,
          data
        }]
      });
      console.log("Standard transaction executed successfully:", tx);
      return tx;
    }
  };

  const handleCreateFraction = async () => {
    if (!isWalletConnected || !address || !chainId) {
      setError('Wallet not connected or network not supported');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);
    setTxHash(null);
    
    try {
      const fractionalizeAddress = getContractAddressForNetwork(chainId, 'Fractionalize');
      if (!fractionalizeAddress) {
        throw new Error('Fractionalize contract not deployed on this network');
      }
      const abi = await getFractionalizeAbi(chainId);
      
      // Prepare the fraction creation parameters
      const params = {
        assetType: 0, // DeedNFT
        originalTokenId: deedNFT.tokenId,
        name: createForm.name,
        description: createForm.description,
        symbol: createForm.symbol,
        collectionUri: createForm.collectionUri,
        totalShares: parseInt(createForm.totalShares),
        burnable: createForm.burnable,
        approvalPercentage: parseInt(createForm.approvalPercentage),
      };

      console.log('Creating fraction with params:', params);
      
      const tx = await executeAppKitTransaction(
        fractionalizeAddress,
        abi,
        'createFraction',
        [params]
      );
      console.log('Transaction sent:', tx);
      
      // Wait for transaction receipt to check actual execution status
      const receipt = await waitForTransactionReceipt(tx);
      
      if (receipt.status === 1) {
        setTxHash(tx);
        setSuccess(true);
        setCreateForm({
          name: '',
          description: '',
          symbol: '',
          collectionUri: '',
          totalShares: '',
          approvalPercentage: '75',
          burnable: true,
        });
      } else {
        const errorMessage = await parseTransactionError(tx);
        setError(`Transaction failed: ${errorMessage}`);
      }
    } catch (error: any) {
      console.error('Error creating fraction:', error);
      setError(`Error creating fraction: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleMintShares = async () => {
    if (!isWalletConnected || !address || !chainId) {
      setError('Wallet not connected or network not supported');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);
    setTxHash(null);
    
    try {
      const fractionalizeAddress = getContractAddressForNetwork(chainId, 'Fractionalize');
      if (!fractionalizeAddress) {
        throw new Error('Fractionalize contract not deployed on this network');
      }
      const abi = await getFractionalizeAbi(chainId);
      
      const recipient = mintForm.recipient || address || '';
      
      const tx = await executeAppKitTransaction(
        fractionalizeAddress,
        abi,
        'mintShares',
        [
          parseInt(mintForm.fractionId),
          parseInt(mintForm.amount),
          recipient
        ]
      );
      
      console.log('Transaction sent:', tx);
      
      // Wait for transaction receipt to check actual execution status
      const receipt = await waitForTransactionReceipt(tx);
      
      if (receipt.status === 1) {
        setTxHash(tx);
        setSuccess(true);
        setMintForm({ fractionId: '', amount: '', recipient: '' });
      } else {
        const errorMessage = await parseTransactionError(tx);
        setError(`Transaction failed: ${errorMessage}`);
      }
    } catch (error: any) {
      console.error('Error minting shares:', error);
      setError(`Error minting shares: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockAsset = async () => {
    if (!isWalletConnected || !address || !chainId) {
      setError('Wallet not connected or network not supported');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);
    setTxHash(null);
    
    try {
      const fractionalizeAddress = getContractAddressForNetwork(chainId, 'Fractionalize');
      if (!fractionalizeAddress) {
        throw new Error('Fractionalize contract not deployed on this network');
      }
      const abi = await getFractionalizeAbi(chainId);
      
      const params = {
        fractionId: parseInt(unlockForm.fractionId),
        to: unlockForm.recipient || address || '',
        checkApprovals: unlockForm.checkApprovals,
      };
      
      const tx = await executeAppKitTransaction(
        fractionalizeAddress,
        abi,
        'unlockAsset',
        [params]
      );
      
      console.log('Transaction sent:', tx);
      
      // Wait for transaction receipt to check actual execution status
      const receipt = await waitForTransactionReceipt(tx);
      
      if (receipt.status === 1) {
        setTxHash(tx);
        setSuccess(true);
        setUnlockForm({ fractionId: '', recipient: '', checkApprovals: true });
      } else {
        const errorMessage = await parseTransactionError(tx);
        setError(`Transaction failed: ${errorMessage}`);
      }
    } catch (error: any) {
      console.error('Error unlocking asset:', error);
      setError(`Error unlocking asset: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Refresh logic - reload component state
    setTimeout(() => {
      setIsRefreshing(false);
      clearMessages();
    }, 500);
  };

  const toggleFullPage = () => {
    setIsFullPage(!isFullPage);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        clearMessages();
        setIsFullPage(false);
        onClose();
      }
    }}>
      <DialogContent className={`${isFullPage ? 'max-w-[95vw] md:max-w-[95vw] max-h-[95vh]' : 'max-w-4xl max-h-[90vh]'} overflow-y-auto`}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
            <Coins className="w-5 h-5" />
              <DialogTitle>Fractionalize T-Deed #{deedNFT.tokenId}</DialogTitle>
            </div>
            <div className="flex items-center space-x-1 md:space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 md:w-5 md:h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleFullPage}
                className="hidden md:block text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title={isFullPage ? 'Minimize' : 'Expand'}
              >
                {isFullPage ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title="Close"
              >
                <X className="w-4 h-4 md:w-5 md:h-5" />
              </Button>
            </div>
          </div>
          <DialogDescription>
            Create tradeable shares from your {getAssetTypeLabel(deedNFT.assetType)} asset
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* T-Deed Info */}
          <Card className="bg-white dark:bg-[#141414] border-black/10 dark:border-white/10">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">{getAssetTypeLabel(deedNFT.assetType)} #{deedNFT.tokenId}</CardTitle>
              <CardDescription>{deedNFT.definition}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Badge variant="outline">Owner: {deedNFT.owner.substring(0, 6)}...{deedNFT.owner.substring(deedNFT.owner.length - 4)}</Badge>
                <Badge variant="outline">Asset Type: {getAssetTypeLabel(deedNFT.assetType)}</Badge>
                <Badge variant={getValidationStatus(deedNFT).status === "Validated" ? "default" : "destructive"}>
                  {getValidationStatus(deedNFT).status}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Tab Navigation */}
          <div className="flex space-x-1 bg-gray-100 dark:bg-[#0e0e0e] p-1 rounded-lg border border-black/10 dark:border-white/10">
            <button
              onClick={() => {
                setActiveTab('create');
                clearMessages();
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'create'
                  ? 'bg-white dark:bg-[#141414] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Create Fraction
            </button>
            <button
              onClick={() => {
                setActiveTab('mint');
                clearMessages();
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'mint'
                  ? 'bg-white dark:bg-[#141414] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Mint Shares
            </button>
            <button
              onClick={() => {
                setActiveTab('unlock');
                clearMessages();
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'unlock'
                  ? 'bg-white dark:bg-[#141414] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Unlock Asset
            </button>
          </div>

          {/* Success/Error Messages */}
          {error && (
            <Alert className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-red-700 dark:text-red-300">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
              <CheckCircle className="h-4 w-4" />
              <AlertDescription className="text-green-700 dark:text-green-300">
                Transaction successful! {txHash && `Hash: ${txHash}`}
              </AlertDescription>
            </Alert>
          )}

          {/* Create Fraction Tab */}
          {activeTab === 'create' && (
            <Card className="bg-white dark:bg-[#141414] border-black/10 dark:border-white/10">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Create New Fraction
                </CardTitle>
                <CardDescription>
                  Lock your asset and create tradeable shares
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Collection Name</Label>
                    <Input
                      id="name"
                      value={createForm.name}
                      onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                      placeholder="My Fraction Collection"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="symbol">Symbol</Label>
                    <Input
                      id="symbol"
                      value={createForm.symbol}
                      onChange={(e) => setCreateForm({ ...createForm, symbol: e.target.value })}
                      placeholder="MFC"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                    placeholder="Describe your fraction collection..."
                    rows={3}
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="totalShares">Total Shares</Label>
                    <Input
                      id="totalShares"
                      type="number"
                      value={createForm.totalShares}
                      onChange={(e) => setCreateForm({ ...createForm, totalShares: e.target.value })}
                      placeholder="1000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="approvalPercentage">Approval %</Label>
                    <Input
                      id="approvalPercentage"
                      type="number"
                      value={createForm.approvalPercentage}
                      onChange={(e) => setCreateForm({ ...createForm, approvalPercentage: e.target.value })}
                      placeholder="75"
                      min="51"
                      max="100"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="collectionUri">Collection URI</Label>
                  <Input
                    id="collectionUri"
                    value={createForm.collectionUri}
                    onChange={(e) => setCreateForm({ ...createForm, collectionUri: e.target.value })}
                    placeholder="https://example.com/metadata"
                  />
                </div>
                
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="burnable"
                    checked={createForm.burnable}
                    onChange={(e) => setCreateForm({ ...createForm, burnable: e.target.checked })}
                  />
                  <Label htmlFor="burnable">Allow share burning</Label>
                </div>
                
                <Button 
                  onClick={handleCreateFraction} 
                  disabled={loading || !createForm.name || !createForm.symbol || !createForm.totalShares}
                  className="w-full"
                >
                  {loading ? 'Creating...' : 'Create Fraction'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Mint Shares Tab */}
          {activeTab === 'mint' && (
            <Card className="bg-white dark:bg-[#141414] border-black/10 dark:border-white/10">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Mint Shares
                </CardTitle>
                <CardDescription>
                  Mint shares for an existing fraction
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="mintFractionId">Fraction ID</Label>
                  <Input
                    id="mintFractionId"
                    value={mintForm.fractionId}
                    onChange={(e) => setMintForm({ ...mintForm, fractionId: e.target.value })}
                    placeholder="1"
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="mintAmount">Amount</Label>
                    <Input
                      id="mintAmount"
                      type="number"
                      value={mintForm.amount}
                      onChange={(e) => setMintForm({ ...mintForm, amount: e.target.value })}
                      placeholder="100"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mintRecipient">Recipient (optional)</Label>
                    <Input
                      id="mintRecipient"
                      value={mintForm.recipient}
                      onChange={(e) => setMintForm({ ...mintForm, recipient: e.target.value })}
                      placeholder="0x..."
                    />
                  </div>
                </div>
                
                <Button 
                  onClick={handleMintShares} 
                  disabled={loading || !mintForm.fractionId || !mintForm.amount}
                  className="w-full"
                >
                  {loading ? 'Minting...' : 'Mint Shares'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Unlock Asset Tab */}
          {activeTab === 'unlock' && (
            <Card className="bg-white dark:bg-[#141414] border-black/10 dark:border-white/10">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                  <Unlock className="w-5 h-5" />
                  Unlock Asset
                </CardTitle>
                <CardDescription>
                  Unlock the underlying asset from a fraction
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="unlockFractionId">Fraction ID</Label>
                  <Input
                    id="unlockFractionId"
                    value={unlockForm.fractionId}
                    onChange={(e) => setUnlockForm({ ...unlockForm, fractionId: e.target.value })}
                    placeholder="1"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="unlockRecipient">Recipient (optional)</Label>
                  <Input
                    id="unlockRecipient"
                    value={unlockForm.recipient}
                    onChange={(e) => setUnlockForm({ ...unlockForm, recipient: e.target.value })}
                    placeholder="0x..."
                  />
                </div>
                
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="checkApprovals"
                    checked={unlockForm.checkApprovals}
                    onChange={(e) => setUnlockForm({ ...unlockForm, checkApprovals: e.target.checked })}
                  />
                  <Label htmlFor="checkApprovals">Check approval requirements</Label>
                </div>
                
                <Button 
                  onClick={handleUnlockAsset} 
                  disabled={loading || !unlockForm.fractionId}
                  className="w-full"
                >
                  {loading ? 'Unlocking...' : 'Unlock Asset'}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FractionalizeModal;