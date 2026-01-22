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
import { MapPin, Plus, Users, CheckCircle, AlertCircle, RefreshCw, Maximize2, Minimize2, X } from 'lucide-react';
import { ethers } from 'ethers';
import { getContractAddressForNetwork } from '@/config/networks';
import type { DeedNFT } from '@/hooks/useDeedNFTData';

interface SubdivideModalProps {
  deedNFT: DeedNFT;
  isOpen: boolean;
  onClose: () => void;
  getAssetTypeLabel: (assetType: number) => string;
}

// Dynamic ABI loading function for Subdivide contract
const getSubdivideAbi = async () => {
  try {
    // For now, always use base-sepolia since that's where Subdivide is deployed
    const abiModule = await import('@/contracts/base-sepolia/Subdivide.json');
    return JSON.parse(abiModule.default.abi);
  } catch (error) {
    console.error('Error loading Subdivide ABI:', error);
    throw new Error('Failed to load Subdivide ABI');
  }
};

const SubdivideModal = ({ deedNFT, isOpen, onClose, getAssetTypeLabel }: SubdivideModalProps) => {
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
        // Transaction was included but failed - check common Subdivide.sol error conditions
        return 'The subdivision could not be created. Common causes: DeedNFT not validated, asset type not supported (only Land and Estate), or subdivision already exists.';
      }
      
      return 'Transaction failed - please check that the DeedNFT is validated and meets subdivision requirements.';
    } catch (error) {
      console.error('Error parsing transaction error:', error);
      return 'Transaction failed - please check that the DeedNFT is validated and meets subdivision requirements.';
    }
  };
  
  // Check if this asset type can be subdivided (only Land and Estate)
  const canSubdivide = deedNFT.assetType === 0 || deedNFT.assetType === 2;
  
  // Form states
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    symbol: '',
    collectionUri: '',
    totalUnits: '',
    burnable: false
  });

  const [mintForm, setMintForm] = useState({
    unitId: '',
    to: ''
  });

  const [batchMintForm, setBatchMintForm] = useState({
    unitIds: '',
    recipients: ''
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

  const handleCreateSubdivision = async () => {
    if (!isWalletConnected || !address || !chainId) {
      setError('Please connect your wallet and ensure you are on the correct network');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);
    setTxHash(null);
    
    try {
      // Get contract address and ABI
      const contractAddress = getContractAddressForNetwork(chainId, 'Subdivide');
      if (!contractAddress) {
        setError('Subdivide contract not deployed on this network');
        setLoading(false);
        return;
      }
      const abi = await getSubdivideAbi();
      
      // Validate form data
      if (!createForm.name || !createForm.symbol || !createForm.collectionUri || !createForm.totalUnits) {
        setError('Please fill in all required fields');
        setLoading(false);
        return;
      }

      const totalUnits = parseInt(createForm.totalUnits);
      if (isNaN(totalUnits) || totalUnits <= 0) {
        setError('Total units must be a positive number');
        setLoading(false);
        return;
      }

      console.log('Creating subdivision:', { deedId: deedNFT.tokenId, ...createForm });
      
      // Call createSubdivision function
      const txHash = await executeAppKitTransaction(
        contractAddress,
        abi,
        'createSubdivision',
        [
          deedNFT.tokenId,
          createForm.name,
          createForm.description,
          createForm.symbol,
          createForm.collectionUri,
          totalUnits,
          createForm.burnable
        ]
      );
      
      // Wait for transaction receipt to check actual execution status
      const receipt = await waitForTransactionReceipt(txHash);
      
      if (receipt.status === 1) {
        setTxHash(txHash);
        setSuccess(true);
        setCreateForm({
          name: '',
          description: '',
          symbol: '',
          collectionUri: '',
          totalUnits: '',
          burnable: false
        });
      } else {
        // Parse specific error messages from the smart contract
        const errorMessage = await parseTransactionError(txHash);
        setError(`Transaction failed: ${errorMessage}`);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error creating subdivision:', error);
      setError('Error creating subdivision: ' + (error as Error).message);
      setLoading(false);
    }
  };

  const handleMintUnit = async () => {
    if (!isWalletConnected || !address || !chainId) {
      setError('Please connect your wallet and ensure you are on the correct network');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);
    setTxHash(null);
    
    try {
      // Get contract address and ABI
      const contractAddress = getContractAddressForNetwork(chainId, 'Subdivide');
      if (!contractAddress) {
        setError('Subdivide contract not deployed on this network');
        setLoading(false);
        return;
      }
      const abi = await getSubdivideAbi();
      
      // Validate form data
      if (!mintForm.unitId) {
        setError('Please enter a unit ID');
        setLoading(false);
        return;
      }

      const unitId = parseInt(mintForm.unitId);
      if (isNaN(unitId) || unitId < 0) {
        setError('Unit ID must be a non-negative number');
        setLoading(false);
        return;
      }

      console.log('Minting unit:', { deedId: deedNFT.tokenId, ...mintForm });
      
      // Call mintUnit function
      const txHash = await executeAppKitTransaction(
        contractAddress,
        abi,
        'mintUnit',
        [
          deedNFT.tokenId,
          unitId,
          mintForm.to || address // Use provided address or current user
        ]
      );
      
      // Wait for transaction receipt to check actual execution status
      const receipt = await waitForTransactionReceipt(txHash);
      
      if (receipt.status === 1) {
        setTxHash(txHash);
        setSuccess(true);
        setMintForm({ unitId: '', to: '' });
      } else {
        const errorMessage = await parseTransactionError(txHash);
        setError(`Transaction failed: ${errorMessage}`);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error minting unit:', error);
      setError('Error minting unit/parcel: ' + (error as Error).message);
      setLoading(false);
    }
  };

  const handleBatchMintUnits = async () => {
    if (!isWalletConnected || !address || !chainId) {
      setError('Please connect your wallet and ensure you are on the correct network');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);
    setTxHash(null);
    
    try {
      // Get contract address and ABI
      const contractAddress = getContractAddressForNetwork(chainId, 'Subdivide');
      if (!contractAddress) {
        setError('Subdivide contract not deployed on this network');
        setLoading(false);
        return;
      }
      const abi = await getSubdivideAbi();
      
      // Parse unit IDs and recipients
      const unitIds = batchMintForm.unitIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      const recipients = batchMintForm.recipients.split(',').map(addr => addr.trim()).filter(addr => addr);
      
      // Validate form data
      if (unitIds.length === 0) {
        setError('Please enter valid unit IDs');
        setLoading(false);
        return;
      }

      if (recipients.length > 0 && recipients.length !== unitIds.length) {
        setError('Number of recipients must match number of unit IDs');
        setLoading(false);
        return;
      }

      // If no recipients provided, use current user for all
      const finalRecipients = recipients.length > 0 ? recipients : new Array(unitIds.length).fill(address);

      console.log('Batch minting units:', { deedId: deedNFT.tokenId, unitIds, recipients: finalRecipients });
      
      // Call batchMintUnits function
      const txHash = await executeAppKitTransaction(
        contractAddress,
        abi,
        'batchMintUnits',
        [
          deedNFT.tokenId,
          unitIds,
          finalRecipients
        ]
      );
      
      // Wait for transaction receipt to check actual execution status
      const receipt = await waitForTransactionReceipt(txHash);
      
      if (receipt.status === 1) {
        setTxHash(txHash);
        setSuccess(true);
        setBatchMintForm({ unitIds: '', recipients: '' });
      } else {
        const errorMessage = await parseTransactionError(txHash);
        setError(`Transaction failed: ${errorMessage}`);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error batch minting units:', error);
      setError('Error batch minting units/parcels: ' + (error as Error).message);
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
            <MapPin className="w-5 h-5" />
              <DialogTitle>Subdivide T-Deed #{deedNFT.tokenId}</DialogTitle>
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
            Create subdivisions and manage units/parcels for your {getAssetTypeLabel(deedNFT.assetType)}
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
              </div>
            </CardContent>
          </Card>

          {/* Warning for non-subdividable assets */}
          {!canSubdivide && (
            <Card className="border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-[#141414]">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <p className="font-medium">
                    Subdivision is only available for Land and Estate T-Deeds.
                  </p>
                </div>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-2">
                  {getAssetTypeLabel(deedNFT.assetType)} T-Deeds cannot be subdivided. Only Land and Estate assets support subdivision functionality.
                </p>
              </CardContent>
            </Card>
          )}

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
              Create
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
              Mint Units
            </button>
            <button
              onClick={() => {
                setActiveTab('batch');
                clearMessages();
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'batch'
                  ? 'bg-white dark:bg-[#141414] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Batch Mint
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

          {/* Create Subdivision Tab */}
          {activeTab === 'create' && (
            <Card className="bg-white dark:bg-[#141414] border-black/10 dark:border-white/10">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Create New Subdivision
                </CardTitle>
                <CardDescription>
                  Create a new subdivision for your T-Deed asset
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!canSubdivide ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500 dark:text-gray-400">
                      Subdivision is not available for {getAssetTypeLabel(deedNFT.assetType)} T-Deeds.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="name">Subdivision Name</Label>
                        <Input
                          id="name"
                          value={createForm.name}
                          onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                          placeholder="Enter subdivision name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="symbol">Symbol</Label>
                        <Input
                          id="symbol"
                          value={createForm.symbol}
                          onChange={(e) => setCreateForm({ ...createForm, symbol: e.target.value })}
                          placeholder="e.g., DPU"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        value={createForm.description}
                        onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                        placeholder="Enter subdivision description"
                        rows={3}
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="totalUnits">Total Units/Parcels</Label>
                        <Input
                          id="totalUnits"
                          type="number"
                          value={createForm.totalUnits}
                          onChange={(e) => setCreateForm({ ...createForm, totalUnits: e.target.value })}
                          placeholder="Number of units/parcels"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="collectionUri">Collection URI</Label>
                        <Input
                          id="collectionUri"
                          value={createForm.collectionUri}
                          onChange={(e) => setCreateForm({ ...createForm, collectionUri: e.target.value })}
                          placeholder="https://metadata.example.com"
                        />
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2 pt-2">
                      <input
                        type="checkbox"
                        id="burnable"
                        checked={createForm.burnable}
                        onChange={(e) => setCreateForm({ ...createForm, burnable: e.target.checked })}
                        className="rounded"
                      />
                      <Label htmlFor="burnable">Allow burning of units/parcels</Label>
                    </div>
                    
                    <div className="pt-4">
                      <Button 
                        onClick={handleCreateSubdivision} 
                        disabled={loading}
                        className="w-full"
                      >
                        {loading ? 'Creating...' : 'Create Subdivision'}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Mint Unit Tab */}
          {activeTab === 'mint' && (
            <Card className="bg-white dark:bg-[#141414] border-black/10 dark:border-white/10">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Mint Unit/Parcel
                </CardTitle>
                <CardDescription>
                  Mint a new unit or parcel in an existing subdivision
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!canSubdivide ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500 dark:text-gray-400">
                      Subdivision is not available for {getAssetTypeLabel(deedNFT.assetType)} T-Deeds.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="unitId">Unit/Parcel ID</Label>
                        <Input
                          id="unitId"
                          value={mintForm.unitId}
                          onChange={(e) => setMintForm({ ...mintForm, unitId: e.target.value })}
                          placeholder="Enter unit/parcel ID"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="mintTo">Recipient (optional)</Label>
                        <Input
                          id="mintTo"
                          value={mintForm.to}
                          onChange={(e) => setMintForm({ ...mintForm, to: e.target.value })}
                          placeholder="Leave empty for self"
                        />
                      </div>
                    </div>
                    
                    <div className="pt-4">
                      <Button 
                        onClick={handleMintUnit} 
                        disabled={loading}
                        className="w-full"
                      >
                        {loading ? 'Minting...' : 'Mint Unit/Parcel'}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Batch Mint Tab */}
          {activeTab === 'batch' && (
            <Card className="bg-white dark:bg-[#141414] border-black/10 dark:border-white/10">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Batch Mint Units/Parcels
                </CardTitle>
                <CardDescription>
                  Mint multiple units or parcels in a single transaction
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!canSubdivide ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500 dark:text-gray-400">
                      Subdivision is not available for {getAssetTypeLabel(deedNFT.assetType)} T-Deeds.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="unitIds">Unit/Parcel IDs (comma-separated)</Label>
                        <Input
                          id="unitIds"
                          value={batchMintForm.unitIds}
                          onChange={(e) => setBatchMintForm({ ...batchMintForm, unitIds: e.target.value })}
                          placeholder="e.g., 0,1,2,3"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="recipients">Recipients (comma-separated, optional)</Label>
                        <Input
                          id="recipients"
                          value={batchMintForm.recipients}
                          onChange={(e) => setBatchMintForm({ ...batchMintForm, recipients: e.target.value })}
                          placeholder="Leave empty for self"
                        />
                      </div>
                    </div>
                    
                    <div className="pt-4">
                      <Button 
                        onClick={handleBatchMintUnits} 
                        disabled={loading}
                        className="w-full"
                      >
                        {loading ? 'Batch Minting...' : 'Batch Mint Units/Parcels'}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SubdivideModal;
