import React, { useState, useEffect } from "react";
import type { ChangeEvent } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppKitAccount, useAppKitNetwork, useAppKitProvider } from '@reown/appkit/react';
import type { Eip1193Provider } from 'ethers';
import { NetworkWarning } from "@/components/NetworkWarning";
import { useNetworkValidation } from "@/hooks/useNetworkValidation";
import { useSmartAccountDeployment } from "@/hooks/useSmartAccountDeployment";
import { getContractAddressForNetwork, getAbiPathForNetwork } from "@/config/networks";
import { ChevronRight, ChevronLeft, CheckCircle, AlertCircle, Wallet, FileText, Settings, CreditCard, Tags, Plus, Trash2, Database, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

// Dynamic ABI loading functions
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

const getValidatorAbi = async (chainId: number) => {
  try {
    const abiPath = getAbiPathForNetwork(chainId, 'Validator');
    const abiModule = await import(abiPath);
    return JSON.parse(abiModule.default.abi);
  } catch (error) {
    console.error('Error loading Validator ABI:', error);
    const fallbackModule = await import('@/contracts/base-sepolia/Validator.json');
    return JSON.parse(fallbackModule.default.abi);
  }
};

const getFundManagerAbi = async (chainId: number) => {
  try {
    const abiPath = getAbiPathForNetwork(chainId, 'FundManager');
    const abiModule = await import(abiPath);
    return JSON.parse(abiModule.default.abi);
  } catch (error) {
    console.error('Error loading FundManager ABI:', error);
    const fallbackModule = await import('@/contracts/base-sepolia/FundManager.json');
    return JSON.parse(fallbackModule.default.abi);
  }
};

const getMetadataRendererAbi = async (chainId: number) => {
  try {
    const abiPath = getAbiPathForNetwork(chainId, 'MetadataRenderer');
    const abiModule = await import(abiPath);
    return JSON.parse(abiModule.default.abi);
  } catch (error) {
    console.error('Error loading MetadataRenderer ABI:', error);
    const fallbackModule = await import('@/contracts/base-sepolia/MetadataRenderer.json');
    return JSON.parse(fallbackModule.default.abi);
  }
};

// Asset types matching the contract enum
const assetTypes = [
  { value: "0", label: "Land", description: "Real estate land parcels" },
  { value: "1", label: "Vehicle", description: "Automobiles and transport" },
  { value: "2", label: "Estate", description: "Complete property estates" },
  { value: "3", label: "Commercial Equipment", description: "Business machinery and equipment" }
];

// Form steps (includes optional Traits and Advanced Metadata steps)
const STEPS = [
  { id: 1, title: "Basic Information", icon: FileText, description: "Asset details and definition" },
  { id: 2, title: "Configuration", icon: Settings, description: "Advanced settings and validation" },
  { id: 3, title: "Traits (Optional)", icon: Tags, description: "Add key traits to your T‑Deed" },
  { id: 4, title: "Advanced Metadata (Optional)", icon: Database, description: "Add rich metadata to your T‑Deed" },
  { id: 5, title: "Payment & Fees", icon: CreditCard, description: "Service fees and payment options" },
  { id: 6, title: "Review & Mint", icon: CheckCircle, description: "Final review and minting" }
];

// Token icons mapping
const TOKEN_ICONS: { [key: string]: string } = {
  "0x0000000000000000000000000000000000000000": "https://cryptologos.cc/logos/ethereum-eth-logo.png",
  "0x4200000000000000000000000000000000000006": "https://cryptologos.cc/logos/ethereum-eth-logo.png", // WETH
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": "https://cryptologos.cc/logos/usd-coin-usdc-logo.png", // USDC
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb": "https://cryptologos.cc/logos/dai-new-logo.png", // DAI
};

const MintForm = () => {
  const navigate = useNavigate();
  const {
    address,
    isConnected,
    embeddedWalletInfo,
    status
  } = useAppKitAccount();
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
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [mintedTokenId, setMintedTokenId] = useState<string | null>(null);

  // Fee calculation state
  const [whitelistedTokens, setWhitelistedTokens] = useState<Array<{ address: string; symbol: string; decimals: number; icon: string }>>([]);
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [serviceFee, setServiceFee] = useState<string>("0");
  const [commissionPercentage, setCommissionPercentage] = useState<string>("0");
  const [totalFee, setTotalFee] = useState<string>("0");
  const [isLoadingFees, setIsLoadingFees] = useState(false);
  const [fundManagerAddress, setFundManagerAddress] = useState<string>("");
  const [hasFundManager, setHasFundManager] = useState(false);
  
  // Traits (optional)
  type TraitItem = { name: string; value: string };
  const [traits, setTraits] = useState<TraitItem[]>([]);
  const addTrait = () => setTraits(prev => ([...prev, { name: "", value: "" }]));
  const removeTrait = (index: number) => setTraits(prev => prev.filter((_, i) => i !== index));
  const updateTrait = (index: number, key: keyof TraitItem, value: string) => {
    setTraits(prev => prev.map((t, i) => i === index ? { ...t, [key]: value } as TraitItem : t));
  };
  
  // Document type for advanced metadata
  type DocumentItem = { docType: string; documentURI: string };
  
  // Advanced Metadata (optional)
  const [advancedMetadata, setAdvancedMetadata] = useState({
    customMetadata: "",
    animationURL: "",
    externalLink: "",
    documents: [] as DocumentItem[],
    generalCondition: "",
    lastInspectionDate: "",
    knownIssues: "",
    improvements: "",
    additionalNotes: "",
    jurisdiction: "",
    registrationNumber: "",
    registrationDate: "",
    legalDocuments: "",
    restrictions: "",
    additionalLegalInfo: "",
    features: "",
    imageUrls: ""
  });

  // Batch approval state
  const [showBatchApproval, setShowBatchApproval] = useState(false);
  const [batchTransactions, setBatchTransactions] = useState<any[]>([]);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);

  // Add/remove document functions
  const addDocument = () => setAdvancedMetadata(prev => ({ 
    ...prev, 
    documents: [...prev.documents, { docType: "", documentURI: "" }] 
  }));
  const removeDocument = (index: number) => setAdvancedMetadata(prev => ({ 
    ...prev, 
    documents: prev.documents.filter((_, i) => i !== index) 
  }));
  const updateDocument = (index: number, key: keyof DocumentItem, value: string) => {
    setAdvancedMetadata(prev => ({
      ...prev,
      documents: prev.documents.map((doc, i) => i === index ? { ...doc, [key]: value } : doc)
    }));
  };

  // Trait suggestions based on asset type
  const getTraitSuggestions = (assetType: string) => {
    switch (assetType) {
      case "0": // Land
        return [
          { name: "streetNumber", label: "Street Number", placeholder: "e.g., 123" },
          { name: "streetName", label: "Street Name", placeholder: "e.g., Main Street" },
          { name: "city", label: "City", placeholder: "e.g., Los Angeles" },
          { name: "state", label: "State", placeholder: "e.g., CA" },
          { name: "zipCode", label: "ZIP Code", placeholder: "e.g., 90210" },
          { name: "country", label: "Country", placeholder: "e.g., USA" },
          { name: "parcelNumber", label: "Parcel Number", placeholder: "e.g., 123-456-789" },
          { name: "acreage", label: "Acreage", placeholder: "e.g., 2.5" },
          { name: "zoning", label: "Zoning", placeholder: "e.g., Residential" },
          { name: "landUse", label: "Land Use", placeholder: "e.g., Single Family" }
        ];
      case "1": // Vehicle
        return [
          { name: "year", label: "Year", placeholder: "e.g., 2020" },
          { name: "make", label: "Make", placeholder: "e.g., Toyota" },
          { name: "model", label: "Model", placeholder: "e.g., Camry" },
          { name: "vin", label: "VIN", placeholder: "e.g., 1HGBH41JXMN109186" },
          { name: "color", label: "Color", placeholder: "e.g., Silver" },
          { name: "mileage", label: "Mileage", placeholder: "e.g., 50000" },
          { name: "engine", label: "Engine", placeholder: "e.g., 2.5L 4-Cylinder" },
          { name: "transmission", label: "Transmission", placeholder: "e.g., Automatic" },
          { name: "fuelType", label: "Fuel Type", placeholder: "e.g., Gasoline" },
          { name: "licensePlate", label: "License Plate", placeholder: "e.g., ABC123" }
        ];
      case "2": // Estate
        return [
          { name: "streetNumber", label: "Street Number", placeholder: "e.g., 123" },
          { name: "streetName", label: "Street Name", placeholder: "e.g., Main Street" },
          { name: "city", label: "City", placeholder: "e.g., Los Angeles" },
          { name: "state", label: "State", placeholder: "e.g., CA" },
          { name: "zipCode", label: "ZIP Code", placeholder: "e.g., 90210" },
          { name: "country", label: "Country", placeholder: "e.g., USA" },
          { name: "parcelNumber", label: "Parcel Number", placeholder: "e.g., 123-456-789" },
          { name: "squareFootage", label: "Square Footage", placeholder: "e.g., 2500" },
          { name: "bedrooms", label: "Bedrooms", placeholder: "e.g., 3" },
          { name: "bathrooms", label: "Bathrooms", placeholder: "e.g., 2.5" },
          { name: "propertyType", label: "Property Type", placeholder: "e.g., Single Family" },
          { name: "yearBuilt", label: "Year Built", placeholder: "e.g., 1995" }
        ];
      case "3": // Commercial Equipment
        return [
          { name: "manufacturer", label: "Manufacturer", placeholder: "e.g., Caterpillar" },
          { name: "model", label: "Model", placeholder: "e.g., D6T" },
          { name: "serialNumber", label: "Serial Number", placeholder: "e.g., CAT00D6T123456" },
          { name: "equipmentType", label: "Equipment Type", placeholder: "e.g., Bulldozer" },
          { name: "yearManufactured", label: "Year Manufactured", placeholder: "e.g., 2018" },
          { name: "horsepower", label: "Horsepower", placeholder: "e.g., 200" },
          { name: "weight", label: "Weight (tons)", placeholder: "e.g., 25" },
          { name: "fuelType", label: "Fuel Type", placeholder: "e.g., Diesel" },
          { name: "condition", label: "Condition", placeholder: "e.g., Excellent" },
          { name: "location", label: "Location", placeholder: "e.g., Construction Site A" }
        ];
      default:
        return [];
    }
  };

  // Add suggested traits based on asset type
  const addSuggestedTraits = () => {
    const suggestions = getTraitSuggestions(form.assetType);
    const newTraits = suggestions.map(suggestion => ({
      name: suggestion.name,
      value: ""
    }));
    setTraits(prev => [...prev, ...newTraits]);
  };

  // Batch Approval Modal Component
  const BatchApprovalModal = () => {
    const totalGas = batchTransactions.length * 100000; // Estimate 100k gas per transaction
    const estimatedCost = ethers.formatEther(ethers.parseUnits(totalGas.toString(), 'wei'));
    
    const traitTransactions = batchTransactions.filter(t => t.type === 'trait');
    const metadataTransactions = batchTransactions.filter(t => t.type === 'metadata');
    
    return (
      <Dialog open={showBatchApproval} onOpenChange={setShowBatchApproval}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Batch Transaction Approval</DialogTitle>
            <DialogDescription>
              Approve multiple transactions to set traits and metadata on your T-Deed
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
              <div className="flex justify-between text-sm">
                <span>Total Transactions:</span>
                <span className="font-medium">{batchTransactions.length}</span>
              </div>
              {traitTransactions.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span>Trait Transactions:</span>
                  <span className="font-medium">{traitTransactions.length}</span>
                </div>
              )}
              {metadataTransactions.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span>Metadata Transactions:</span>
                  <span className="font-medium">{metadataTransactions.length}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span>Estimated Gas:</span>
                <span className="font-medium">{totalGas.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Estimated Cost:</span>
                <span className="font-medium">~{estimatedCost} ETH</span>
              </div>
            </div>
            
            <div className="max-h-40 overflow-y-auto">
              {traitTransactions.length > 0 && (
                <div className="mb-3">
                  <h4 className="font-medium mb-2">Traits to be set:</h4>
                  {traits.map((trait, index) => (
                    <div key={index} className="text-sm text-gray-600 dark:text-gray-400">
                      • {trait.name}: {trait.value}
                    </div>
                  ))}
                </div>
              )}
              
              {metadataTransactions.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Metadata to be set:</h4>
                  {advancedMetadata.customMetadata && (
                    <div className="text-sm text-gray-600 dark:text-gray-400">• Custom Metadata</div>
                  )}
                  {advancedMetadata.animationURL && (
                    <div className="text-sm text-gray-600 dark:text-gray-400">• Animation URL</div>
                  )}
                  {advancedMetadata.externalLink && (
                    <div className="text-sm text-gray-600 dark:text-gray-400">• External Link</div>
                  )}
                  {advancedMetadata.documents.length > 0 && (
                    <div className="text-sm text-gray-600 dark:text-gray-400">• {advancedMetadata.documents.length} Documents</div>
                  )}
                  {advancedMetadata.generalCondition && (
                    <div className="text-sm text-gray-600 dark:text-gray-400">• Asset Condition</div>
                  )}
                  {advancedMetadata.jurisdiction && (
                    <div className="text-sm text-gray-600 dark:text-gray-400">• Legal Information</div>
                  )}
                  {advancedMetadata.features && (
                    <div className="text-sm text-gray-600 dark:text-gray-400">• Features</div>
                  )}
                  {advancedMetadata.imageUrls && (
                    <div className="text-sm text-gray-600 dark:text-gray-400">• Gallery Images</div>
                  )}
                </div>
              )}
            </div>
            
            {isProcessingBatch && (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Processing transactions...</span>
                </div>
                <Progress value={batchProgress} className="h-2" />
                <p className="text-xs text-gray-500">{batchProgress}% complete</p>
              </div>
            )}
            
            <div className="flex space-x-2">
              <Button 
                variant="outline" 
                onClick={() => setShowBatchApproval(false)} 
                disabled={isProcessingBatch}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button 
                onClick={executeBatchTraits}
                disabled={isProcessingBatch}
                className="flex-1"
              >
                {isProcessingBatch ? 'Processing...' : 'Approve All'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  // Waits for receipt using walletProvider (embedded wallets)
  const waitForReceiptWalletProvider = async (txHash: string) => {
    if (!walletProvider) throw new Error('No walletProvider available');
    let attempts = 0;
    while (attempts < 60) {
      const receipt = await (walletProvider as any).request({
        method: 'eth_getTransactionReceipt',
        params: [txHash]
      });
      if (receipt && receipt.blockNumber) return receipt;
      await new Promise(r => setTimeout(r, 1500));
      attempts++;
    }
    throw new Error('Timed out waiting for transaction receipt');
  };

  // Extract tokenId from receipt logs by parsing DeedNFTMinted event
  const extractTokenIdFromReceipt = async (receipt: any, deedNftAbi: any): Promise<bigint | null> => {
    try {
      const iface = new ethers.Interface(deedNftAbi);
      const logs = receipt.logs || receipt.receipts || [];
      for (const log of logs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics, data: log.data });
          if (parsed && parsed.name === 'DeedNFTMinted') {
            const tokenId = parsed.args[0] as bigint;
            return tokenId;
          }
        } catch (_) {}
      }
      return null;
    } catch (e) {
      console.error('Failed to parse receipt logs for tokenId:', e);
      return null;
    }
  };

  // Apply collected traits and metadata after mint using batch approval
  const applyTraitsAfterMint = async (
    tokenId: bigint,
    contractAddress: string,
    deedNftAbi: any
  ) => {
    try {
      const allTransactions: any[] = [];
      
      // Add trait transactions
      if (traits.length > 0) {
        const traitTransactions = traits.map(trait => ({
          to: contractAddress,
          data: new ethers.Interface(deedNftAbi).encodeFunctionData('setTrait', [
            Number(tokenId),
            ethers.toUtf8Bytes(trait.name),
            ethers.toUtf8Bytes(trait.value),
            1 // string type
          ]),
          value: "0",
          type: 'trait'
        }));
        allTransactions.push(...traitTransactions);
      }
      
      // Add metadata transactions if any metadata exists
      const hasMetadata = Object.values(advancedMetadata).some(value => {
        if (Array.isArray(value)) {
          return value.length > 0;
        }
        return typeof value === 'string' && value.trim();
      });
      
      if (hasMetadata) {
        // Get MetadataRenderer address
        let metadataRendererAddress: string;
        
        if (walletProvider && embeddedWalletInfo) {
          const result = await (walletProvider as any).request({
            method: 'eth_call',
            params: [{
              to: contractAddress,
              data: new ethers.Interface(deedNftAbi).encodeFunctionData('metadataRenderer', [])
            }, 'latest']
          });
          metadataRendererAddress = new ethers.Interface(deedNftAbi).decodeFunctionResult('metadataRenderer', result)[0];
        } else {
          // For MetaMask, we'll get this in the execute function
          metadataRendererAddress = "";
        }
        
        if (metadataRendererAddress && metadataRendererAddress !== ethers.ZeroAddress) {
          const metadataRendererAbi = await getMetadataRendererAbi(chainId!);
          
          // Add metadata transactions
          if (advancedMetadata.customMetadata.trim()) {
            allTransactions.push({
              to: metadataRendererAddress,
              data: new ethers.Interface(metadataRendererAbi).encodeFunctionData('setTokenCustomMetadata', [
                Number(tokenId),
                advancedMetadata.customMetadata
              ]),
              value: "0",
              type: 'metadata'
            });
          }
          
          if (advancedMetadata.animationURL.trim()) {
            allTransactions.push({
              to: metadataRendererAddress,
              data: new ethers.Interface(metadataRendererAbi).encodeFunctionData('setTokenAnimationURL', [
                Number(tokenId),
                advancedMetadata.animationURL
              ]),
              value: "0",
              type: 'metadata'
            });
          }
          
          if (advancedMetadata.externalLink.trim()) {
            allTransactions.push({
              to: metadataRendererAddress,
              data: new ethers.Interface(metadataRendererAbi).encodeFunctionData('setTokenExternalLink', [
                Number(tokenId),
                advancedMetadata.externalLink
              ]),
              value: "0",
              type: 'metadata'
            });
          }
          
          // Add document transactions
          for (const doc of advancedMetadata.documents) {
            if (doc.docType.trim() && doc.documentURI.trim()) {
              allTransactions.push({
                to: metadataRendererAddress,
                data: new ethers.Interface(metadataRendererAbi).encodeFunctionData('manageTokenDocument', [
                  Number(tokenId),
                  doc.docType,
                  doc.documentURI,
                  false // isRemove = false
                ]),
                value: "0",
                type: 'metadata'
              });
            }
          }
          
          // Add other metadata transactions (condition, legal info, features, gallery)
          if (advancedMetadata.generalCondition.trim()) {
            const knownIssues = advancedMetadata.knownIssues ? advancedMetadata.knownIssues.split(',').map(s => s.trim()).filter(s => s) : [];
            const improvements = advancedMetadata.improvements ? advancedMetadata.improvements.split(',').map(s => s.trim()).filter(s => s) : [];
            
            allTransactions.push({
              to: metadataRendererAddress,
              data: new ethers.Interface(metadataRendererAbi).encodeFunctionData('setAssetCondition', [
                Number(tokenId),
                advancedMetadata.generalCondition,
                advancedMetadata.lastInspectionDate || "",
                knownIssues,
                improvements,
                advancedMetadata.additionalNotes || ""
              ]),
              value: "0",
              type: 'metadata'
            });
          }
          
          if (advancedMetadata.jurisdiction.trim()) {
            const documents = advancedMetadata.legalDocuments ? advancedMetadata.legalDocuments.split(',').map(s => s.trim()).filter(s => s) : [];
            const restrictions = advancedMetadata.restrictions ? advancedMetadata.restrictions.split(',').map(s => s.trim()).filter(s => s) : [];
            
            allTransactions.push({
              to: metadataRendererAddress,
              data: new ethers.Interface(metadataRendererAbi).encodeFunctionData('setTokenLegalInfo', [
                Number(tokenId),
                advancedMetadata.jurisdiction,
                advancedMetadata.registrationNumber || "",
                advancedMetadata.registrationDate || "",
                documents,
                restrictions,
                advancedMetadata.additionalLegalInfo || ""
              ]),
              value: "0",
              type: 'metadata'
            });
          }
          
          if (advancedMetadata.features.trim()) {
            const features = advancedMetadata.features.split(',').map(s => s.trim()).filter(s => s);
            
            allTransactions.push({
              to: metadataRendererAddress,
              data: new ethers.Interface(metadataRendererAbi).encodeFunctionData('setTokenFeatures', [
                Number(tokenId),
                features
              ]),
              value: "0",
              type: 'metadata'
            });
          }
          
          if (advancedMetadata.imageUrls.trim()) {
            const imageUrls = advancedMetadata.imageUrls.split('\n').map(s => s.trim()).filter(s => s);
            
            allTransactions.push({
              to: metadataRendererAddress,
              data: new ethers.Interface(metadataRendererAbi).encodeFunctionData('setTokenGallery', [
                Number(tokenId),
                imageUrls
              ]),
              value: "0",
              type: 'metadata'
            });
          }
        }
      }
      
      if (allTransactions.length > 0) {
        setBatchTransactions(allTransactions);
        setShowBatchApproval(true);
      }
    } catch (e) {
      console.error('Failed to prepare batch transactions:', e);
      setError('Mint succeeded but preparing batch transactions failed. You can add them on the Validation page.');
    }
  };

  // Execute batch trait transactions
  const executeBatchTraits = async () => {
    if (batchTransactions.length === 0) return;
    
    setIsProcessingBatch(true);
    setBatchProgress(0);
    
    try {
      if (walletProvider && embeddedWalletInfo) {
        // For AppKit embedded wallets, execute transactions sequentially
        for (let i = 0; i < batchTransactions.length; i++) {
          const transaction = batchTransactions[i];
          const prepared = await prepareTransaction(transaction);
          await (walletProvider as any).request({ 
            method: 'eth_sendTransaction', 
            params: [prepared] 
          });
          
          // Update progress
          setBatchProgress(((i + 1) / batchTransactions.length) * 100);
          
          // Small delay between transactions
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } else {
        // For MetaMask, we need to get the signer and execute transactions sequentially
        if (!window.ethereum) {
          throw new Error("No wallet detected");
        }
        
        const provider = new ethers.BrowserProvider(window.ethereum as unknown as Eip1193Provider);
        const signer = await provider.getSigner();
        
        // Get MetadataRenderer address for metadata transactions
        const deedNFTContract = new ethers.Contract(batchTransactions[0].to, await getDeedNFTAbi(chainId!), signer);
        const metadataRendererAddress = await deedNFTContract.metadataRenderer();
        
        for (let i = 0; i < batchTransactions.length; i++) {
          const transaction = batchTransactions[i];
          
          if (transaction.type === 'trait') {
            // Execute trait transaction
            const tx = await deedNFTContract.setTrait(
              Number(mintedTokenId),
              ethers.toUtf8Bytes(traits[i].name),
              ethers.toUtf8Bytes(traits[i].value),
              1 // string type
            );
            await tx.wait();
          } else if (transaction.type === 'metadata') {
            // Execute metadata transaction using the encoded data
            const tx = await signer.sendTransaction({
              to: metadataRendererAddress,
              data: transaction.data
            });
            await tx.wait();
          }
          
          // Update progress
          setBatchProgress(((i + 1) / batchTransactions.length) * 100);
        }
      }
      
      setShowBatchApproval(false);
      setBatchTransactions([]);
      setIsProcessingBatch(false);
      setBatchProgress(0);
      
      // Reset both traits and advanced metadata after successful batch processing
      setTraits([]);
      setAdvancedMetadata({
        customMetadata: "",
        animationURL: "",
        externalLink: "",
        documents: [],
        generalCondition: "",
        lastInspectionDate: "",
        knownIssues: "",
        improvements: "",
        additionalNotes: "",
        jurisdiction: "",
        registrationNumber: "",
        registrationDate: "",
        legalDocuments: "",
        restrictions: "",
        additionalLegalInfo: "",
        features: "",
        imageUrls: ""
      });
      
    } catch (e) {
      console.error('Failed to execute batch transactions:', e);
      setError('Mint succeeded but applying traits and metadata failed. You can add them on the Validation page.');
      setShowBatchApproval(false);
      setIsProcessingBatch(false);
      setBatchProgress(0);
    }
  };

  // Form state matching DeedNFT.sol parameters
  const [form, setForm] = useState({
    // Basic Information (Step 1)
    owner: "",
    assetType: "0",
    definition: "",
    
    // Configuration (Step 2)
    uri: "",
    configuration: "",
    validatorAddress: "",
    requiresValidation: false,
    validationCriteria: "",
    
    // Payment & Fees (Step 5)
    token: "",
    usePaymentToken: false,
    useCustomValidator: false,
    useMetadataURI: false,
    useCustomSalt: false,
    salt: "",
    
    // Review (Step 6)
    estimatedGas: "0",
    totalCost: "0"
  });

  const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (value: string) => {
    setForm(prev => ({ ...prev, assetType: value }));
  };

  const handleCheckboxChange = (name: string, checked: boolean | string) => {
    setForm(prev => ({ ...prev, [name]: Boolean(checked) }));
  };

  // Load FundManager and fee data
  useEffect(() => {
    if (isConnected && chainId) {
      loadFundManagerData();
    }
  }, [isConnected, chainId]);

  // Load fee data when validator changes
  useEffect(() => {
    if (selectedToken && (form.useCustomValidator ? form.validatorAddress : fundManagerAddress)) {
      loadFeeData();
    }
  }, [selectedToken, form.validatorAddress, form.useCustomValidator, fundManagerAddress]);

  const loadFundManagerData = async () => {
    try {
      if (!chainId) return;

      // Use AppKit provider for embedded wallets, otherwise fallback to MetaMask
      let provider;
      
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit provider for embedded wallet");
        provider = walletProvider as any;
      } else {
        console.log("Using MetaMask provider");
        if (!window.ethereum) return;
        
        // Add a small delay to ensure the provider is properly initialized on mobile
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Double-check that ethereum is still available after the delay
        if (!window.ethereum) {
          console.error("Ethereum provider not available after initialization delay.");
          return;
        }
        
        provider = new ethers.BrowserProvider(window.ethereum as unknown as Eip1193Provider);
      }
      
      // Get DeedNFT contract to check if FundManager is set
      const deedNFTAddress = getContractAddressForNetwork(chainId);
      if (!deedNFTAddress) return;

      const deedNFTAbi = await getDeedNFTAbi(chainId);
      const deedNFTContract = new ethers.Contract(deedNFTAddress, deedNFTAbi, provider);
      
      // Check if FundManager is set
      const fundManagerAddr = await deedNFTContract.fundManager();
      setFundManagerAddress(fundManagerAddr);
      setHasFundManager(fundManagerAddr !== ethers.ZeroAddress);

      if (fundManagerAddr !== ethers.ZeroAddress && chainId) {
        // Load whitelisted tokens from FundManager
        const fundManagerAbi = await getFundManagerAbi(chainId);
        const fundManagerContract = new ethers.Contract(fundManagerAddr, fundManagerAbi, provider);
        
        const whitelistedTokenAddresses = await fundManagerContract.getWhitelistedTokens();
        const commissionPct = await fundManagerContract.getCommissionPercentage();
        setCommissionPercentage(commissionPct.toString());

        // Load token details
        const tokenDetails = await Promise.all(
          whitelistedTokenAddresses.map(async (tokenAddr: string) => {
            try {
              // Try to get token symbol and decimals
              const tokenContract = new ethers.Contract(tokenAddr, [
                "function symbol() view returns (string)",
                "function decimals() view returns (uint8)"
              ], provider);
              
              const [symbol, decimals] = await Promise.all([
                tokenContract.symbol(),
                tokenContract.decimals()
              ]);

              return {
                address: tokenAddr,
                symbol,
                decimals: Number(decimals),
                icon: TOKEN_ICONS[tokenAddr] || "https://cryptologos.cc/logos/ethereum-eth-logo.png"
              };
            } catch (error) {
              // Fallback for tokens without standard interface
              return {
                address: tokenAddr,
                symbol: "Unknown",
                decimals: 18,
                icon: "https://cryptologos.cc/logos/ethereum-eth-logo.png"
              };
            }
          })
        );

        setWhitelistedTokens(tokenDetails);
        if (tokenDetails.length > 0) {
          setSelectedToken(tokenDetails[0].address);
        }
      }
    } catch (error) {
      console.error('Error loading FundManager data:', error);
    }
  };

  const loadFeeData = async () => {
    if (!selectedToken || !chainId) return;

    setIsLoadingFees(true);
    try {
      // Use AppKit provider for embedded wallets, otherwise fallback to MetaMask
      let provider;
      
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit provider for embedded wallet");
        provider = walletProvider as any;
      } else {
        console.log("Using MetaMask provider");
        if (!window.ethereum) return;
        
        // Add a small delay to ensure the provider is properly initialized on mobile
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Double-check that ethereum is still available after the delay
        if (!window.ethereum) {
          console.error("Ethereum provider not available after initialization delay.");
          return;
        }
        
        provider = new ethers.BrowserProvider(window.ethereum as unknown as Eip1193Provider);
      }
      
      // Determine which validator to use
      const validatorAddress = form.useCustomValidator ? form.validatorAddress : fundManagerAddress;
      if (!validatorAddress || validatorAddress === ethers.ZeroAddress) return;

      // Get service fee from validator
      const validatorAbi = await getValidatorAbi(chainId);
      const validatorContract = new ethers.Contract(validatorAddress, validatorAbi, provider);
      
      const fee = await validatorContract.getServiceFee(selectedToken);
      setServiceFee(fee.toString());

      // Calculate total fee including commission
      const feeAmount = BigInt(fee);
      const commissionAmount = (feeAmount * BigInt(commissionPercentage)) / 10000n;
      const total = feeAmount + commissionAmount;
      setTotalFee(total.toString());

    } catch (error) {
      console.error('Error loading fee data:', error);
      setServiceFee("0");
      setTotalFee("0");
    } finally {
      setIsLoadingFees(false);
    }
  };

  React.useEffect(() => {
    if (address) {
      setForm(prev => ({ ...prev, owner: address }));
    }
  }, [address]);

  const nextStep = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleMint = async () => {
    if (!isConnected || !address) {
      setError("Please connect your wallet first.");
      return;
    }

    if (!form.definition.trim()) {
      setError("Please provide a definition for your T-Deed.");
      return;
    }

    if (!form.owner.trim()) {
      setError("Please provide an owner address for the T-Deed.");
      return;
    }

    if (!ethers.isAddress(form.owner)) {
      setError("Please enter a valid Ethereum address for the owner.");
      return;
    }

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

    setIsLoading(true);
    setError(null);
    setSuccess(false);
    setMintedTokenId(null);

    try {
      if (!chainId) {
        throw new Error("No network detected. Please connect to a supported network.");
      }

      // Use AppKit provider for embedded wallets, otherwise fallback to MetaMask
      let signer;
      
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit provider for embedded wallet");
        console.log("Smart account deployment status:", embeddedWalletInfo.isSmartAccountDeployed);
        console.log("Wallet provider:", walletProvider);
        
        // For embedded wallets, we need to use AppKit's transaction system
        // The walletProvider doesn't support direct ethers.js transactions
        // We need to use AppKit's built-in transaction methods
        console.log("Using AppKit transaction system for embedded wallet");
        
        // Get contract address for current network
        const contractAddress = getContractAddressForNetwork(chainId);
        if (!contractAddress) {
          throw new Error("No contract address found for current network");
        }
        
        // Get ABI for current network
        const abi = await getDeedNFTAbi(chainId);
        
        // Prepare parameters matching DeedNFT.sol mintAsset function
        const owner = form.owner;
        const assetType = parseInt(form.assetType);
        const uri = form.useMetadataURI ? form.uri : "";
        const definition = form.definition;
        const configuration = form.configuration;
        const validatorAddress = form.useCustomValidator ? form.validatorAddress : ethers.ZeroAddress;
        const token = form.usePaymentToken && hasFundManager ? selectedToken : ethers.ZeroAddress;
        const salt = form.useCustomSalt ? ethers.toBigInt(form.salt) : 0n;

        console.log("Minting T-Deed with parameters:", {
          owner,
          assetType,
          uri,
          definition,
          configuration,
          validatorAddress,
          token,
          salt
        });

        // Prepare transaction data
        const transactionData = {
          to: contractAddress,
          data: new ethers.Interface(abi).encodeFunctionData('mintAsset', [
            owner,
            assetType,
            uri,
            definition,
            configuration,
            validatorAddress,
            token,
            salt
          ])
        };

        // Use prepareTransaction to handle smart account deployment
        const preparedTransaction = await prepareTransaction(transactionData);
        
        console.log("Prepared transaction:", preparedTransaction);

        // Use AppKit's transaction system - avoid using ethers Contract directly
        const tx = await (walletProvider as any).request({
          method: 'eth_sendTransaction',
          params: [preparedTransaction]
        });

        console.log("Transaction executed successfully:", tx);
        setTxHash(tx);
        // Wait for receipt and parse tokenId
        const receipt = await waitForReceiptWalletProvider(tx);
        const tokenIdFromLogs = await extractTokenIdFromReceipt(receipt, abi);
        if (tokenIdFromLogs) {
          setMintedTokenId(tokenIdFromLogs.toString());
          if (traits.length > 0) {
            await applyTraitsAfterMint(tokenIdFromLogs, contractAddress, abi);
          }
          if (Object.values(advancedMetadata).some(value => {
            if (Array.isArray(value)) {
              return value.length > 0;
            }
            return typeof value === 'string' && value.trim();
          })) {
            await applyTraitsAfterMint(tokenIdFromLogs, contractAddress, abi);
          }
        }
        setSuccess(true);
        
        // Reset form but keep the owner address for convenience
        setForm({
          owner: form.owner, // Keep the owner address
          assetType: "0",
          uri: "",
          definition: "",
          configuration: "",
          validatorAddress: "",
          requiresValidation: false,
          validationCriteria: "",
          token: "",
          usePaymentToken: false,
          useCustomValidator: false,
          useMetadataURI: false,
          useCustomSalt: false,
          salt: "",
          estimatedGas: "0",
          totalCost: "0"
        });
        
        // Reset advanced metadata state
        setAdvancedMetadata({
          customMetadata: "",
          animationURL: "",
          externalLink: "",
          documents: [],
          generalCondition: "",
          lastInspectionDate: "",
          knownIssues: "",
          improvements: "",
          additionalNotes: "",
          jurisdiction: "",
          registrationNumber: "",
          registrationDate: "",
          legalDocuments: "",
          restrictions: "",
          additionalLegalInfo: "",
          features: "",
          imageUrls: ""
        });
        
        // Don't reset traits immediately - they will be reset after batch processing
        // setTraits([]);
        
        return; // Exit early since we handled the transaction
      } else {
        console.log("Using MetaMask provider");
        if (!window.ethereum) {
          throw new Error("No wallet detected. Please install MetaMask or another wallet.");
        }
        const provider = new ethers.BrowserProvider(window.ethereum as unknown as Eip1193Provider);
        signer = await provider.getSigner();
      }
      
      // Get contract address for current network
      const contractAddress = getContractAddressForNetwork(chainId);
      if (!contractAddress) {
        throw new Error("No contract address found for current network");
      }
      
      // Get ABI for current network
      const abi = await getDeedNFTAbi(chainId);
      const contract = new ethers.Contract(contractAddress, abi, signer);

      // Prepare parameters matching DeedNFT.sol mintAsset function
      const owner = form.owner;
      const assetType = parseInt(form.assetType);
      const uri = form.useMetadataURI ? form.uri : "";
      const definition = form.definition;
      const configuration = form.configuration;
      const validatorAddress = form.useCustomValidator ? form.validatorAddress : ethers.ZeroAddress;
      const token = form.usePaymentToken && hasFundManager ? selectedToken : ethers.ZeroAddress;
      const salt = form.useCustomSalt ? ethers.toBigInt(form.salt) : 0n;

      console.log("Minting T-Deed with parameters:", {
        owner,
        assetType,
        uri,
        definition,
        configuration,
        validatorAddress,
        token,
        salt
      });

      console.log("About to execute transaction with signer:", signer);
      console.log("Contract address:", contractAddress);

      const tx = await contract.mintAsset(
        owner,
        assetType,
        uri,
        definition,
        configuration,
        validatorAddress,
        token,
        salt
      );

      console.log("Transaction executed successfully:", tx.hash);
      const receipt = await tx.wait();
      const tokenIdFromLogs = await extractTokenIdFromReceipt(receipt, abi);
      if (tokenIdFromLogs) {
        setMintedTokenId(tokenIdFromLogs.toString());
        if (traits.length > 0) {
          await applyTraitsAfterMint(tokenIdFromLogs, contractAddress, abi);
        }
        if (Object.values(advancedMetadata).some(value => {
          if (Array.isArray(value)) {
            return value.length > 0;
          }
          return typeof value === 'string' && value.trim();
        })) {
          await applyTraitsAfterMint(tokenIdFromLogs, contractAddress, abi);
        }
      }
      setTxHash(tx.hash);
      setSuccess(true);

      // Reset form but keep the owner address for convenience
      setForm({
        owner: form.owner, // Keep the owner address
        assetType: "0",
        uri: "",
        definition: "",
        configuration: "",
        validatorAddress: "",
        requiresValidation: false,
        validationCriteria: "",
        token: "",
        usePaymentToken: false,
        useCustomValidator: false,
        useMetadataURI: false,
        useCustomSalt: false,
        salt: "",
        estimatedGas: "0",
        totalCost: "0"
      });

      // Reset advanced metadata state
      setAdvancedMetadata({
        customMetadata: "",
        animationURL: "",
        externalLink: "",
        documents: [],
        generalCondition: "",
        lastInspectionDate: "",
        knownIssues: "",
        improvements: "",
        additionalNotes: "",
        jurisdiction: "",
        registrationNumber: "",
        registrationDate: "",
        legalDocuments: "",
        restrictions: "",
        additionalLegalInfo: "",
        features: "",
        imageUrls: ""
      });
      
      // Don't reset traits immediately - they will be reset after batch processing
      // setTraits([]);

    } catch (err) {
      console.error("Minting error:", err);
      
      // Check for specific smart account deployment errors
      const errorMessage = err instanceof Error ? err.message : "Failed to mint T-Deed. Please try again.";
      
      if (errorMessage.includes("smart account") || errorMessage.includes("deployment") || errorMessage.includes("not deployed")) {
        setError("Smart account deployment failed. Please try again or contact support.");
      } else if (errorMessage.includes("insufficient funds") || errorMessage.includes("gas")) {
        setError("Insufficient funds for transaction. Please ensure you have enough ETH for gas fees.");
      } else if (errorMessage.includes("contract runner does not support calling")) {
        setError("Wallet provider compatibility issue. Please try using a different wallet or contact support.");
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getStepProgress = () => {
    return (currentStep / STEPS.length) * 100;
  };

  const getStepStatus = (stepId: number) => {
    if (stepId < currentStep) return "completed";
    if (stepId === currentStep) return "current";
    return "pending";
  };

  const formatTokenAmount = (amount: string, decimals: number) => {
    try {
      const value = ethers.parseUnits(amount, decimals);
      return ethers.formatUnits(value, decimals);
    } catch {
      return "0";
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="owner" className="text-gray-700 dark:text-gray-200 font-medium text-sm">Owner Address</Label>
              <Input
                id="owner"
                name="owner"
                value={form.owner}
                onChange={handleInputChange}
                placeholder="0x..."
                className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white font-mono h-11"
              />
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {form.owner === address ? "Connected wallet address" : "Custom recipient address"}
                </p>
                {form.owner !== address && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setForm(prev => ({ ...prev, owner: address || "" }))}
                    className="text-xs border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    Use My Address
                  </Button>
                )}
              </div>
              {form.owner && form.owner !== address && !ethers.isAddress(form.owner) && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  Please enter a valid Ethereum address
                </p>
              )}
            </div>

            <div className="space-y-3">
              <Label htmlFor="assetType" className="text-gray-700 dark:text-gray-200 font-medium text-sm">Asset Type</Label>
              <Select value={form.assetType} onValueChange={handleSelectChange}>
                <SelectTrigger className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white">
                  <SelectValue placeholder="Select asset type">
                    {form.assetType && (
                      <div className="flex items-center justify-between w-full">
                        <span className="font-medium">{assetTypes.find(t => t.value === form.assetType)?.label}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                          {assetTypes.find(t => t.value === form.assetType)?.description}
                        </span>
                      </div>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#141414] border-black/10 dark:border-white/10">
                  {assetTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value} className="text-gray-900 dark:text-white py-3">
                      <div className="flex items-center justify-between w-full">
                        <div className="font-medium text-sm">{type.label}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 ml-2">{type.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label htmlFor="definition" className="text-gray-700 dark:text-gray-200 font-medium text-sm">Definition *</Label>
              <Textarea
                id="definition"
                name="definition"
                value={form.definition}
                onChange={handleInputChange}
                placeholder="Describe the asset in detail..."
                rows={4}
                className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white min-h-[120px]"
                required
              />
              <p className="text-sm text-gray-500 dark:text-gray-400">Required field for minting</p>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="useMetadataURI"
                  checked={form.useMetadataURI}
                  onCheckedChange={(checked) => handleCheckboxChange("useMetadataURI", checked)}
                  className="border-black/10 dark:border-white/10"
                />
                <Label htmlFor="useMetadataURI" className="text-gray-700 dark:text-gray-200 font-medium text-sm">
                  Add metadata URI
                </Label>
              </div>
              {form.useMetadataURI && (
                <div className="space-y-3">
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Metadata URI</Label>
                  <Input
                    name="uri"
                    value={form.uri}
                    onChange={handleInputChange}
                    placeholder="ipfs://... or https://..."
                    className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white h-11"
                  />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <Label htmlFor="configuration" className="text-gray-700 dark:text-gray-200 font-medium text-sm">Configuration</Label>
              <Textarea
                id="configuration"
                name="configuration"
                value={form.configuration}
                onChange={handleInputChange}
                placeholder="Additional configuration details..."
                rows={3}
                className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white min-h-[100px]"
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="useCustomValidator"
                  checked={form.useCustomValidator}
                  onCheckedChange={(checked) => handleCheckboxChange("useCustomValidator", checked)}
                  className="border-black/10 dark:border-white/10"
                />
                <Label htmlFor="useCustomValidator" className="text-gray-700 dark:text-gray-200 font-medium text-sm">
                  Use custom validator
                </Label>
              </div>
              {form.useCustomValidator && (
                <div className="space-y-3">
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Validator Address</Label>
                  <Input
                    name="validatorAddress"
                    value={form.validatorAddress}
                    onChange={handleInputChange}
                    placeholder="0x..."
                    className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white h-11"
                  />
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="useCustomSalt"
                  checked={form.useCustomSalt}
                  onCheckedChange={(checked) => handleCheckboxChange("useCustomSalt", checked)}
                  className="border-black/10 dark:border-white/10"
                />
                <Label htmlFor="useCustomSalt" className="text-gray-700 dark:text-gray-200 font-medium text-sm">
                  Use custom salt for token ID
                </Label>
              </div>
              {form.useCustomSalt && (
                <div className="space-y-3">
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Custom Salt</Label>
                  <Input
                    name="salt"
                    value={form.salt}
                    onChange={handleInputChange}
                    placeholder="0"
                    type="number"
                    min="0"
                    className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white h-11"
                  />
                </div>
              )}
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Add Traits (Optional)</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Add key traits to your T-Deed. You can add custom traits or use suggested traits based on your asset type.
              </p>
            </div>

            {/* Suggested Traits Section */}
            {form.assetType && getTraitSuggestions(form.assetType).length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">
                      Suggested Traits for {assetTypes.find(t => t.value === form.assetType)?.label}
                    </Label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Common traits for this asset type
                    </p>
                  </div>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={addSuggestedTraits} 
                    className="h-9 border-black/10 dark:border-white/10"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add Suggested
                  </Button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {getTraitSuggestions(form.assetType).map((suggestion, index) => (
                    <div key={index} className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{suggestion.label}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{suggestion.placeholder}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Custom Traits Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Custom Traits</Label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Add your own custom traits
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addTrait} className="h-9 border-black/10 dark:border-white/10">
                  <Plus className="w-4 h-4 mr-1" /> Add Custom
                </Button>
              </div>
              
              {traits.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No traits added yet.</p>
              ) : (
                <div className="space-y-3">
                  {traits.map((t, i) => (
                    <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                      <div className="space-y-2 md:col-span-2">
                        <Label className="text-xs text-gray-600 dark:text-gray-300">Trait Name</Label>
                        <Input 
                          value={t.name} 
                          onChange={e => updateTrait(i, 'name', e.target.value)} 
                          placeholder="e.g., color, size, year" 
                          className="h-11 border-black/10 dark:border-white/10" 
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label className="text-xs text-gray-600 dark:text-gray-300">Value</Label>
                        <div className="flex items-center gap-2">
                          <Input 
                            value={t.value} 
                            onChange={e => updateTrait(i, 'value', e.target.value)} 
                            placeholder="Enter value" 
                            className="h-11 border-black/10 dark:border-white/10" 
                          />
                          <Button type="button" variant="outline" size="icon" onClick={() => removeTrait(i)} className="h-11 w-11 border-black/10 dark:border-white/10">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <p className="text-xs text-gray-500 dark:text-gray-400">You can also manage advanced metadata later in the Validation dashboard.</p>
          </div>
        );

      case 4:
        return (
          <div className="space-y-8">
            <div className="text-center mb-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Advanced Metadata (Optional)</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Add rich metadata to your T-Deed. All fields are optional and can be managed later in the Validation dashboard.
              </p>
            </div>

            {/* Basic Metadata Section */}
            <div className="space-y-6">
              <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                <h4 className="text-md font-medium text-gray-900 dark:text-white">Basic Metadata</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">Core metadata for your T-Deed</p>
              </div>

              {/* Custom Metadata */}
              <div className="space-y-3">
                <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Custom Metadata (JSON)</Label>
                <Textarea
                  value={advancedMetadata.customMetadata}
                  onChange={(e) => setAdvancedMetadata(prev => ({ ...prev, customMetadata: e.target.value }))}
                  placeholder="Enter custom metadata as JSON..."
                  className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white min-h-[100px]"
                  rows={3}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">Add custom JSON metadata for advanced use cases</p>
              </div>

              {/* Animation URL */}
              <div className="space-y-3">
                <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Animation URL</Label>
                <Input
                  value={advancedMetadata.animationURL}
                  onChange={(e) => setAdvancedMetadata(prev => ({ ...prev, animationURL: e.target.value }))}
                  placeholder="https://example.com/animation.mp4"
                  className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white h-11"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">URL to animated content (GIF, MP4, etc.)</p>
              </div>

              {/* External Link */}
              <div className="space-y-3">
                <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">External Link</Label>
                <Input
                  value={advancedMetadata.externalLink}
                  onChange={(e) => setAdvancedMetadata(prev => ({ ...prev, externalLink: e.target.value }))}
                  placeholder="https://example.com"
                  className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white h-11"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">External website or marketplace listing</p>
              </div>
            </div>

            {/* Document Management Section */}
            <div className="space-y-6">
              <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                <h4 className="text-md font-medium text-gray-900 dark:text-white">Document Management</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">Add official documents and certificates</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Documents</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addDocument} className="h-9 border-black/10 dark:border-white/10">
                    <Plus className="w-4 h-4 mr-1" /> Add Document
                  </Button>
                </div>

                {advancedMetadata.documents.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No documents added yet.</p>
                ) : (
                  <div className="space-y-3">
                    {advancedMetadata.documents.map((doc, index) => (
                      <div key={index} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-600 dark:text-gray-300">Document Type</Label>
                          <Input
                            value={doc.docType}
                            onChange={(e) => updateDocument(index, 'docType', e.target.value)}
                            placeholder="e.g., deed, title, inspection"
                            className="h-11 border-black/10 dark:border-white/10"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-600 dark:text-gray-300">Document URI</Label>
                          <Input
                            value={doc.documentURI}
                            onChange={(e) => updateDocument(index, 'documentURI', e.target.value)}
                            placeholder="https://example.com/document.pdf"
                            className="h-11 border-black/10 dark:border-white/10"
                          />
                        </div>
                        <div className="flex items-center">
                          <Button type="button" variant="outline" size="icon" onClick={() => removeDocument(index)} className="h-11 w-11 border-black/10 dark:border-white/10">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Asset Condition Section */}
            <div className="space-y-6">
              <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                <h4 className="text-md font-medium text-gray-900 dark:text-white">Asset Condition</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">Track the condition and maintenance history</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">General Condition</Label>
                  <Select 
                    value={advancedMetadata.generalCondition} 
                    onValueChange={(value) => setAdvancedMetadata(prev => ({ ...prev, generalCondition: value }))}
                  >
                    <SelectTrigger className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white h-11">
                      <SelectValue placeholder="Select condition" />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-[#141414] border-black/10 dark:border-white/10">
                      <SelectItem value="Excellent">Excellent</SelectItem>
                      <SelectItem value="Good">Good</SelectItem>
                      <SelectItem value="Fair">Fair</SelectItem>
                      <SelectItem value="Poor">Poor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Last Inspection Date</Label>
                  <Input
                    type="date"
                    value={advancedMetadata.lastInspectionDate}
                    onChange={(e) => setAdvancedMetadata(prev => ({ ...prev, lastInspectionDate: e.target.value }))}
                    className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white h-11"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Additional Notes</Label>
                <Textarea
                  value={advancedMetadata.additionalNotes}
                  onChange={(e) => setAdvancedMetadata(prev => ({ ...prev, additionalNotes: e.target.value }))}
                  placeholder="Additional notes about the asset condition..."
                  className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white"
                  rows={3}
                />
              </div>
            </div>

            {/* Legal Information Section */}
            <div className="space-y-6">
              <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                <h4 className="text-md font-medium text-gray-900 dark:text-white">Legal Information</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">Legal jurisdiction and registration details</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-3">
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Jurisdiction</Label>
                  <Input
                    value={advancedMetadata.jurisdiction}
                    onChange={(e) => setAdvancedMetadata(prev => ({ ...prev, jurisdiction: e.target.value }))}
                    placeholder="e.g., California, USA"
                    className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white h-11"
                  />
                </div>
                <div className="space-y-3">
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Registration Number</Label>
                  <Input
                    value={advancedMetadata.registrationNumber}
                    onChange={(e) => setAdvancedMetadata(prev => ({ ...prev, registrationNumber: e.target.value }))}
                    placeholder="Official registration number"
                    className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white h-11"
                  />
                </div>
                <div className="space-y-3">
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Registration Date</Label>
                  <Input
                    type="date"
                    value={advancedMetadata.registrationDate}
                    onChange={(e) => setAdvancedMetadata(prev => ({ ...prev, registrationDate: e.target.value }))}
                    className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white h-11"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Additional Legal Info</Label>
                <Textarea
                  value={advancedMetadata.additionalLegalInfo}
                  onChange={(e) => setAdvancedMetadata(prev => ({ ...prev, additionalLegalInfo: e.target.value }))}
                  placeholder="Additional legal information..."
                  className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white"
                  rows={3}
                />
              </div>
            </div>

            {/* Features and Gallery Section */}
            <div className="space-y-6">
              <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                <h4 className="text-md font-medium text-gray-900 dark:text-white">Features & Gallery</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">Asset features and image gallery</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Features (comma-separated)</Label>
                  <Textarea
                    value={advancedMetadata.features}
                    onChange={(e) => setAdvancedMetadata(prev => ({ ...prev, features: e.target.value }))}
                    placeholder="e.g., pool, garage, garden, security system"
                    className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white"
                    rows={3}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">List key features of the asset</p>
                </div>
                <div className="space-y-3">
                  <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Image URLs (one per line)</Label>
                  <Textarea
                    value={advancedMetadata.imageUrls}
                    onChange={(e) => setAdvancedMetadata(prev => ({ ...prev, imageUrls: e.target.value }))}
                    placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg"
                    className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white"
                    rows={3}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">Add multiple images for the gallery</p>
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              All metadata will be applied after minting. You can also manage this metadata later in the Validation dashboard.
            </p>
          </div>
        );

      case 5:
        return (
          <div className="space-y-6">
            {hasFundManager ? (
              <>
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="usePaymentToken"
                      checked={form.usePaymentToken}
                      onCheckedChange={(checked) => handleCheckboxChange("usePaymentToken", checked)}
                      className="border-black/10 dark:border-white/10"
                    />
                    <Label htmlFor="usePaymentToken" className="text-gray-700 dark:text-gray-200 font-medium text-sm">
                      Use FundManager payment (Optional)
                    </Label>
                  </div>
                  {form.usePaymentToken && (
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <Label className="text-gray-700 dark:text-gray-200 font-medium text-sm">Payment Token</Label>
                        <Select value={selectedToken} onValueChange={setSelectedToken}>
                          <SelectTrigger className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white">
                            <SelectValue placeholder="Select payment token" />
                          </SelectTrigger>
                          <SelectContent className="bg-white dark:bg-[#141414] border-black/10 dark:border-white/10">
                            {whitelistedTokens.map((token) => (
                              <SelectItem key={token.address} value={token.address} className="text-gray-900 dark:text-white py-3">
                                <div className="flex items-center space-x-3">
                                  <img src={token.icon} alt={token.symbol} className="w-6 h-6 rounded-full" />
                                  <div>
                                    <div className="font-medium text-sm">{token.symbol}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">{token.address.slice(0, 8)}...{token.address.slice(-6)}</div>
                                  </div>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {isLoadingFees ? (
                        <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                          <span className="text-sm">Loading fee information...</span>
                        </div>
                      ) : (
                        <Card className="border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-lg text-gray-900 dark:text-white flex items-center space-x-2">
                              <span>Fee Information</span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="flex justify-between">
                              <span className="text-gray-600 dark:text-gray-300">Service Fee:</span>
                              <span className="text-gray-900 dark:text-white font-medium">
                                {formatTokenAmount(serviceFee, 18)} {whitelistedTokens.find(t => t.address === selectedToken)?.symbol || "ETH"}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600 dark:text-gray-300">Commission ({Number(commissionPercentage) / 100}%):</span>
                              <span className="text-gray-900 dark:text-white font-medium">
                                {formatTokenAmount((BigInt(serviceFee) * BigInt(commissionPercentage) / 10000n).toString(), 18)} {whitelistedTokens.find(t => t.address === selectedToken)?.symbol || "ETH"}
                              </span>
                            </div>
                            <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                              <div className="flex justify-between">
                                <span className="text-gray-900 dark:text-white font-semibold">Total:</span>
                                <span className="text-gray-900 dark:text-white font-semibold">
                                  {formatTokenAmount(totalFee, 18)} {whitelistedTokens.find(t => t.address === selectedToken)?.symbol || "ETH"}
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No FundManager Configured</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  This T-Deed contract is not configured with a FundManager. Minting will proceed without payment processing.
                </p>
              </div>
            )}
          </div>
        );

      case 6:
        return (
          <div className="space-y-6">
            <Card className="border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
              <CardHeader>
                <CardTitle className="text-lg text-gray-900 dark:text-white">Review Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm text-gray-600 dark:text-gray-300">Asset Type</Label>
                    <p className="text-gray-900 dark:text-white font-medium">
                      {assetTypes.find(t => t.value === form.assetType)?.label || "Not selected"}
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm text-gray-600 dark:text-gray-300">Owner</Label>
                    <div className="flex items-center space-x-2">
                      <p className="text-gray-900 dark:text-white font-mono text-sm">{form.owner}</p>
                      {form.owner !== address && (
                        <Badge variant="secondary" className="bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 text-xs">
                          Different Address
                        </Badge>
                      )}
                    </div>
                    {form.owner !== address && (
                      <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                        ⚠️ You are minting to a different address than your connected wallet
                      </p>
                    )}
                  </div>
                  <div className="col-span-2">
                    <Label className="text-sm text-gray-600 dark:text-gray-300">Definition</Label>
                    <p className="text-gray-900 dark:text-white">{form.definition}</p>
                  </div>
                  {form.configuration && (
                    <div className="col-span-2">
                      <Label className="text-sm text-gray-600 dark:text-gray-300">Configuration</Label>
                      <p className="text-gray-900 dark:text-white">{form.configuration}</p>
                    </div>
                  )}
                  {form.usePaymentToken && hasFundManager && (
                    <div className="col-span-2">
                      <Label className="text-sm text-gray-600 dark:text-gray-300">Payment</Label>
                      <div className="flex items-center space-x-2">
                        <img src={whitelistedTokens.find(t => t.address === selectedToken)?.icon} alt="Token" className="w-5 h-5 rounded-full" />
                        <span className="text-gray-900 dark:text-white font-medium">
                          {formatTokenAmount(totalFee, 18)} {whitelistedTokens.find(t => t.address === selectedToken)?.symbol}
                        </span>
                      </div>
                    </div>
                  )}
                  
                  {/* Traits Summary */}
                  {traits.length > 0 && (
                    <div className="col-span-2">
                      <Label className="text-sm text-gray-600 dark:text-gray-300">Traits to Add ({traits.length})</Label>
                      <div className="mt-2 space-y-1">
                        {traits.map((trait, index) => (
                          <div key={index} className="flex items-center space-x-2 text-sm">
                            <span className="text-gray-900 dark:text-white font-medium">{trait.name}:</span>
                            <span className="text-gray-700 dark:text-gray-300">{trait.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Advanced Metadata Summary */}
                  {Object.values(advancedMetadata).some(value => {
                    if (Array.isArray(value)) {
                      return value.length > 0;
                    }
                    return typeof value === 'string' && value.trim();
                  }) && (
                    <div className="col-span-2">
                      <Label className="text-sm text-gray-600 dark:text-gray-300">Advanced Metadata to Add</Label>
                      <div className="mt-2 space-y-1 text-sm">
                        {advancedMetadata.customMetadata && (
                          <div className="flex items-center space-x-2">
                            <span className="text-gray-900 dark:text-white font-medium">Custom Metadata:</span>
                            <span className="text-gray-700 dark:text-gray-300">✓</span>
                          </div>
                        )}
                        {advancedMetadata.animationURL && (
                          <div className="flex items-center space-x-2">
                            <span className="text-gray-900 dark:text-white font-medium">Animation URL:</span>
                            <span className="text-gray-700 dark:text-gray-300">✓</span>
                          </div>
                        )}
                        {advancedMetadata.externalLink && (
                          <div className="flex items-center space-x-2">
                            <span className="text-gray-900 dark:text-white font-medium">External Link:</span>
                            <span className="text-gray-700 dark:text-gray-300">✓</span>
                          </div>
                        )}
                        {advancedMetadata.documents.length > 0 && (
                          <div className="flex items-center space-x-2">
                            <span className="text-gray-900 dark:text-white font-medium">Documents:</span>
                            <span className="text-gray-700 dark:text-gray-300">{advancedMetadata.documents.length} items</span>
                          </div>
                        )}
                        {advancedMetadata.generalCondition && (
                          <div className="flex items-center space-x-2">
                            <span className="text-gray-900 dark:text-white font-medium">Asset Condition:</span>
                            <span className="text-gray-700 dark:text-gray-300">{advancedMetadata.generalCondition}</span>
                          </div>
                        )}
                        {advancedMetadata.jurisdiction && (
                          <div className="flex items-center space-x-2">
                            <span className="text-gray-900 dark:text-white font-medium">Legal Info:</span>
                            <span className="text-gray-700 dark:text-gray-300">{advancedMetadata.jurisdiction}</span>
                          </div>
                        )}
                        {advancedMetadata.features && (
                          <div className="flex items-center space-x-2">
                            <span className="text-gray-900 dark:text-white font-medium">Features:</span>
                            <span className="text-gray-700 dark:text-gray-300">{advancedMetadata.features.split(',').length} items</span>
                          </div>
                        )}
                        {advancedMetadata.imageUrls && (
                          <div className="flex items-center space-x-2">
                            <span className="text-gray-900 dark:text-white font-medium">Gallery:</span>
                            <span className="text-gray-700 dark:text-gray-300">{advancedMetadata.imageUrls.split('\n').filter(s => s.trim()).length} images</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Button
              onClick={handleMint}
              disabled={isLoading || !form.definition.trim() || !isCorrectNetwork}
              className="w-full text-lg font-semibold bg-black hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-black border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 h-11"
              size="lg"
            >
              {isLoading ? 'Minting...' : 'Mint T-Deed'}
            </Button>
            {success && mintedTokenId && (
              <div className="text-center space-y-2">
                <p className="text-sm text-gray-600 dark:text-gray-300">Token ID: <span className="font-mono text-gray-900 dark:text-white">{mintedTokenId}</span></p>
                <Button type="button" variant="outline" onClick={() => navigate('/validation')} className="h-10 border-black/10 dark:border-white/10">
                  Manage in Validation Dashboard
                </Button>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <main className="container mx-auto pt-4 pb-12 px-4">
      <NetworkWarning />
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mt-6">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <Card className="sticky top-24 border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-xl text-gray-900 dark:text-white">Minting Progress</CardTitle>
              <Progress value={getStepProgress()} className="h-2" />
            </CardHeader>
            <CardContent className="space-y-4">
              {STEPS.map((step) => {
                const status = getStepStatus(step.id);
                const Icon = step.icon;
                
                return (
                  <div key={step.id} className="flex items-center space-x-3">
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                      status === "completed" 
                        ? "bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400"
                        : status === "current"
                        ? "bg-gray-100 dark:bg-[#141414] text-gray-600 dark:text-gray-300"
                        : "bg-gray-100 dark:bg-[#141414] text-gray-400 dark:text-gray-500"
                    }`}>
                      {status === "completed" ? (
                        <CheckCircle className="w-5 h-5" />
                      ) : (
                        <Icon className="w-5 h-5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${
                        status === "completed" || status === "current"
                          ? "text-gray-900 dark:text-white"
                          : "text-gray-500 dark:text-gray-400"
                      }`}>
                        {step.title}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* Main Form */}
        <div className="lg:col-span-3">
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-2xl font-bold text-gray-900 dark:text-white">
                {STEPS[currentStep - 1].title}
              </CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-300">
                {STEPS[currentStep - 1].description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!isConnected ? (
                <div className="text-center text-gray-600 dark:text-gray-300 text-lg py-12">
                  <Wallet className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>Please connect your wallet using the button in the header to mint.</p>
                </div>
              ) : !isCorrectNetwork ? (
                <div className="text-center text-gray-600 dark:text-gray-300 text-lg py-12">
                  <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>Please switch to a network with deployed contracts to mint.</p>
                </div>
              ) : (
                <>
                  {renderStepContent()}

                  {error && (
                    <Alert className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
                      <AlertDescription className="text-red-700 dark:text-red-300">{error}</AlertDescription>
                    </Alert>
                  )}

                  {success && (
                    <Alert className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
                      <AlertDescription className="text-green-700 dark:text-green-300">
                        T-Deed minted successfully! Transaction hash: {txHash}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Navigation */}
                  <div className="flex justify-between pt-6">
                    <Button
                      onClick={prevStep}
                      disabled={currentStep === 1}
                      variant="outline"
                      className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11 px-4"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Previous
                    </Button>
                    
                    {currentStep < STEPS.length ? (
                      <Button
                        onClick={nextStep}
                        disabled={!form.definition.trim()}
                        className="bg-black hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-black border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed h-11 px-4"
                      >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      
      {/* Batch Approval Modal */}
      <BatchApprovalModal />
    </main>
  );
};

export default MintForm;