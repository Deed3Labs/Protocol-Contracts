import React, { useState } from "react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { 
  X, 
  Send, 
  Copy,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  FileText,
  MapPin,
  Car,
  Building,
  Wrench
} from "lucide-react";
import { ethers } from "ethers";
import type { DeedNFT } from "@/hooks/useDeedNFTData";
import { useAppKitAccount, useAppKitNetwork, useAppKitProvider } from '@reown/appkit/react';
import { getContractAddressForNetwork, getAbiPathForNetwork } from '@/config/networks';
import { useNetworkValidation } from "@/hooks/useNetworkValidation";
import { useSmartAccountDeployment } from "@/hooks/useSmartAccountDeployment";
import type { Eip1193Provider } from 'ethers';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  deedNFT: DeedNFT;
  getAssetTypeLabel: (assetType: number) => string;
  onTransferSuccess?: () => void;
}

// Custom DialogContent for mobile slide-up animation
const MobileDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 grid w-full gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        // Mobile: slide up from bottom, Desktop: centered with zoom
        "left-0 bottom-0 md:left-[50%] md:top-[50%] md:translate-x-[-50%] md:translate-y-[-50%] md:max-w-2xl",
        // Mobile animations
        "data-[state=closed]:slide-out-to-bottom-full data-[state=open]:slide-in-from-bottom-full",
        // Desktop animations
        "md:data-[state=closed]:zoom-out-95 md:data-[state=open]:zoom-in-95 md:data-[state=closed]:slide-out-to-left-1/2 md:data-[state=closed]:slide-out-to-top-[48%] md:data-[state=open]:slide-in-from-left-1/2 md:data-[state=open]:slide-in-from-top-[48%]",
        "md:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
MobileDialogContent.displayName = DialogPrimitive.Content.displayName;

const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  deedNFT,
  getAssetTypeLabel,
  onTransferSuccess,
}) => {
  const { address, isConnected, embeddedWalletInfo, status } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider("eip155");
  const { isCorrectNetwork } = useNetworkValidation();
  const {
    isEmbeddedWallet,
    isSmartAccountDeployed,
    needsDeployment,
    deploySmartAccount,
    prepareTransaction
  } = useSmartAccountDeployment();
  
  // Derive chainId from caipNetworkId
  const chainId = caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  const [recipientAddress, setRecipientAddress] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isTransactionInProgress, setIsTransactionInProgress] = useState(false);


  const assetTypeLabel = getAssetTypeLabel(deedNFT.assetType);

  const getAssetTypeIcon = (assetType: number) => {
    switch (assetType) {
      case 0: return <MapPin className="w-5 h-5" />; // Land
      case 1: return <Car className="w-5 h-5" />; // Vehicle
      case 2: return <Building className="w-5 h-5" />; // Estate
      case 3: return <Wrench className="w-5 h-5" />; // Commercial Equipment
      default: return <FileText className="w-5 h-5" />;
    }
  };

  const formatAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Dynamic ABI loading function
  const getDeedNFTAbi = async (chainId: number) => {
    try {
      const abiPath = getAbiPathForNetwork(chainId, 'DeedNFT');
      const abiModule = await import(abiPath);
      return JSON.parse(abiModule.default.abi);
    } catch (error) {
      console.error('Error loading DeedNFT ABI:', error);
      const fallbackModule = await import('@/contracts/base-sepolia/DeedNFT.json');
      return JSON.parse(fallbackModule.default.abi);
    }
  };

  const validateAddress = (address: string): boolean => {
    try {
      return ethers.isAddress(address);
    } catch {
      return false;
    }
  };

  const handleTransfer = async () => {
    console.log("TransferModal - Starting transfer with state:", {
      isConnected,
      address,
      walletProvider: !!walletProvider,
      embeddedWalletInfo: !!embeddedWalletInfo,
      chainId,
      isCorrectNetwork
    });

    if (!isConnected || !address) {
      setError("Please connect your wallet first");
      return;
    }

    if (!isCorrectNetwork) {
      setError("Please switch to a supported network");
      return;
    }

    if (!validateAddress(recipientAddress)) {
      setError("Please enter a valid recipient address");
      return;
    }

    if (recipientAddress.toLowerCase() === address.toLowerCase()) {
      setError("Cannot transfer to yourself");
      return;
    }

    if (deedNFT.owner.toLowerCase() !== address.toLowerCase()) {
      setError("You can only transfer T-Deeds that you own");
      return;
    }

    // Show confirmation first
    if (!showConfirmation) {
      setShowConfirmation(true);
      return;
    }

    setIsLoading(true);
    setError(null);
    setIsTransactionInProgress(true);

    try {
      // Debug wallet provider state
      console.log("TransferModal - Wallet state:", {
        walletProvider: !!walletProvider,
        embeddedWalletInfo: !!embeddedWalletInfo,
        isConnected,
        address,
        status,
        chainId,
        isCorrectNetwork
      });

      // Get contract address and ABI
      if (!chainId) {
        throw new Error("No network detected. Please connect to a supported network.");
      }
      
      const contractAddress = getContractAddressForNetwork(chainId);
      
      if (!contractAddress) {
        throw new Error("Contract address not available for this network");
      }
      
      // Load ABI dynamically
      const abi = await getDeedNFTAbi(chainId);

      // Check if we have a wallet provider (either embedded or regular wallet)
      if (!walletProvider) {
        console.error("Wallet provider check failed:", {
          walletProvider: !!walletProvider,
          embeddedWalletInfo: !!embeddedWalletInfo,
          walletProviderType: walletProvider ? typeof walletProvider : 'undefined',
          embeddedWalletInfoType: embeddedWalletInfo ? typeof embeddedWalletInfo : 'undefined'
        });
        throw new Error("Wallet provider not available. Please ensure you are connected to a wallet.");
      }

      // For embedded wallets, we need embeddedWalletInfo
      // For regular wallets (MetaMask, etc.), embeddedWalletInfo will be false but that's okay
      if (embeddedWalletInfo && !embeddedWalletInfo.isSmartAccountDeployed) {
        console.warn("Embedded wallet not deployed, but continuing with regular wallet");
      }

      // Encode the transfer function
      const data = new ethers.Interface(abi).encodeFunctionData('transferFrom', [
        address,
        recipientAddress,
        deedNFT.tokenId
      ]);

      // Debug smart account deployment status
      console.log("Smart Account Debug Info:", {
        embeddedWalletInfo,
        isSmartAccountDeployed,
        isEmbeddedWallet,
        needsDeployment,
        authProvider: embeddedWalletInfo?.authProvider,
        accountType: embeddedWalletInfo?.accountType,
        status
      });

      // If smart account is not deployed, try to deploy it first
      if (needsDeployment) {
        console.log("Smart account not deployed, attempting to deploy...");
        try {
          await deploySmartAccount();
          console.log("Smart account deployment triggered successfully");
        } catch (deployError) {
          console.error("Failed to trigger smart account deployment:", deployError);
          setError("Failed to deploy smart account. Please try again.");
          setIsLoading(false);
          return;
        }
      }

      // Execute the transfer using the appropriate method based on wallet type
      let result;
      
      if (embeddedWalletInfo) {
        // For embedded wallets, use AppKit transaction with smart account support
        console.log("Using AppKit transaction for embedded wallet");
        console.log("Smart account deployment status:", embeddedWalletInfo.isSmartAccountDeployed);
        console.log("Wallet provider:", walletProvider);
        
        // For embedded wallets, we need to use AppKit's transaction system
        // The walletProvider doesn't support direct ethers.js transactions
        // We need to use AppKit's built-in transaction methods
        console.log("Using AppKit transaction system for embedded wallet");
        
        // Prepare transaction data
        const transactionData = {
          to: contractAddress,
          data
        };

        // Use prepareTransaction to handle smart account deployment
        const preparedTransaction = await prepareTransaction(transactionData);
        
        console.log("Prepared transaction:", preparedTransaction);

        // Use AppKit's transaction system
        const tx = await (walletProvider as any).request({
          method: 'eth_sendTransaction',
          params: [preparedTransaction]
        });
        result = tx;
      } else {
        // For regular wallets (MetaMask, etc.), use standard transaction
        console.log("Using standard transaction for regular wallet");
        
        if (!window.ethereum) {
          throw new Error("No wallet detected. Please install MetaMask or another wallet.");
        }
        
        // Add a small delay to ensure the provider is properly initialized on mobile
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Double-check that ethereum is still available after the delay
        if (!window.ethereum) {
          throw new Error("Ethereum provider not available after initialization delay.");
        }
        
        const provider = new ethers.BrowserProvider(window.ethereum as unknown as Eip1193Provider);
        const signer = await provider.getSigner();
        
        // Create contract instance
        const contract = new ethers.Contract(contractAddress, abi, signer);
        
        // Execute transfer
        const tx = await contract.transferFrom(address, recipientAddress, deedNFT.tokenId);
        result = await tx.wait();
      }

      console.log("Transfer transaction executed successfully:", result);

      console.log("Transfer result:", result);
      setSuccess(true);
      
      // Call success callback if provided
      if (onTransferSuccess) {
        onTransferSuccess();
      }

      // Close modal after a short delay
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setRecipientAddress("");
      }, 2000);

    } catch (error) {
      console.error("Transfer error:", error);
      setError(error instanceof Error ? error.message : "Transfer failed. Please try again.");
    } finally {
      setIsLoading(false);
      setIsTransactionInProgress(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onClose();
      setRecipientAddress("");
      setError(null);
      setSuccess(false);
      setShowConfirmation(false);
    }
  };

  return (
    <Dialog open={isOpen && !isTransactionInProgress} onOpenChange={handleClose}>
      <MobileDialogContent className="max-w-2xl px-6 py-4 w-full h-full md:max-h-[90vh] border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#0e0e0e]/90 backdrop-blur-sm overflow-hidden">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-0 border-b-0">
          <div>
            <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white flex items-center space-x-2">
              <Send className="w-5 h-5" />
              <span>Transfer T-Deed</span>
            </DialogTitle>
            <p className="text-gray-600 dark:text-gray-300 mt-1">
              Transfer {assetTypeLabel} #{deedNFT.tokenId} to another address
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={isLoading}
            className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] h-10 w-10 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </DialogHeader>

        <div className="overflow-y-auto h-full max-h-[calc(100vh-120px)] md:max-h-[calc(90vh-120px)]">
          <div className="space-y-4 p-0 md:p-0">
            {/* T-Deed Information */}
            <Card className="border-black/10 dark:border-white/10 bg-white/50 dark:bg-[#141414]/50 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-gray-900 dark:text-white flex items-center space-x-2">
                  {getAssetTypeIcon(deedNFT.assetType)}
                  <span>T-Deed Details</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm text-gray-500 dark:text-gray-400">Asset Type</Label>
                    <p className="text-gray-900 dark:text-white font-medium">{assetTypeLabel}</p>
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500 dark:text-gray-400">Token ID</Label>
                    <p className="text-gray-900 dark:text-white font-medium">#{deedNFT.tokenId}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-sm text-gray-500 dark:text-gray-400">Current Owner</Label>
                  <div className="flex items-center space-x-2 mt-1">
                    <p className="text-gray-900 dark:text-white font-mono text-sm">
                      {formatAddress(deedNFT.owner)}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(deedNFT.owner)}
                      className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-8 px-2"
                    >
                      {copied ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-sm text-gray-500 dark:text-gray-400">Definition</Label>
                  <p className="text-gray-900 dark:text-white text-sm mt-1">
                    {deedNFT.definition.length > 100 
                      ? `${deedNFT.definition.substring(0, 100)}...` 
                      : deedNFT.definition
                    }
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Transfer Form */}
            <Card className="border-black/10 dark:border-white/10 bg-white/50 dark:bg-[#141414]/50 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-gray-900 dark:text-white">Transfer Details</CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-300">
                  Enter the recipient's address to transfer this T-Deed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="recipient" className="text-sm text-gray-500 dark:text-gray-400">
                    Recipient Address
                  </Label>
                  <Input
                    id="recipient"
                    type="text"
                    placeholder="0x..."
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    className="mt-1 border-black/10 dark:border-white/10 bg-white/50 dark:bg-[#141414]/50 text-gray-900 dark:text-white"
                    disabled={isLoading}
                  />
                  {recipientAddress && !validateAddress(recipientAddress) && (
                    <p className="text-red-500 text-xs mt-1">Invalid address format</p>
                  )}
                </div>

                {/* Warning */}
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <div className="flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-yellow-800 dark:text-yellow-200 text-sm font-medium">
                        Transfer Warning
                      </p>
                      <p className="text-yellow-700 dark:text-yellow-300 text-xs mt-1">
                        This action cannot be undone. Make sure you have the correct recipient address and understand the implications of transferring this T-Deed.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Network Warning */}
                {!isCorrectNetwork && (
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                    <div className="flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                      <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                        Please switch to a supported network to transfer T-Deeds.
                      </p>
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {error && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <div className="flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                      <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
                    </div>
                  </div>
                )}

                {/* Confirmation Message */}
                {showConfirmation && !isLoading && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-blue-800 dark:text-blue-200 text-sm font-medium">
                          Confirm Transfer
                        </p>
                        <p className="text-blue-700 dark:text-blue-300 text-xs mt-1">
                          You are about to transfer {assetTypeLabel} #{deedNFT.tokenId} to {formatAddress(recipientAddress)}. 
                          This action cannot be undone. Click "Confirm Transfer" to proceed.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Success Message */}
                {success && (
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <div className="flex items-start space-x-2">
                      <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                      <p className="text-green-800 dark:text-green-200 text-sm">
                        Transfer successful! The T-Deed has been transferred to the recipient.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

                            {/* Actions */}
                <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-4 pt-4">
                  <Button
                    variant="outline"
                    onClick={handleClose}
                    disabled={isLoading}
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleTransfer}
                    disabled={isLoading || !recipientAddress || !validateAddress(recipientAddress) || !isConnected || !isCorrectNetwork}
                    className={`flex-1 ${
                      showConfirmation 
                        ? "bg-red-700 hover:bg-red-800 dark:bg-red-700 dark:hover:bg-red-800" 
                        : "bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700"
                    } text-white`}
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Transferring...
                      </>
                    ) : showConfirmation ? (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Confirm Transfer
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Transfer T-Deed
                      </>
                    )}
                  </Button>
                </div>
          </div>
        </div>
      </MobileDialogContent>
    </Dialog>
  );
};

export default TransferModal; 