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
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAppKitAccount, useAppKitNetwork, useAppKitProvider } from '@reown/appkit/react';
import type { Eip1193Provider } from 'ethers';
import { NetworkWarning } from "@/components/NetworkWarning";
import { useNetworkValidation } from "@/hooks/useNetworkValidation";
import { useSmartAccountDeployment } from "@/hooks/useSmartAccountDeployment";
import { getContractAddressForNetwork, getAbiPathForNetwork } from "@/config/networks";
import { ChevronRight, ChevronLeft, CheckCircle, AlertCircle, Wallet, FileText, Settings, CreditCard, Coins, DollarSign } from "lucide-react";

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

// Asset types matching the contract enum
const assetTypes = [
  { value: "0", label: "Land", description: "Real estate land parcels" },
  { value: "1", label: "Vehicle", description: "Automobiles and transport" },
  { value: "2", label: "Estate", description: "Complete property estates" },
  { value: "3", label: "Commercial Equipment", description: "Business machinery and equipment" }
];

// Form steps
const STEPS = [
  { id: 1, title: "Basic Information", icon: FileText, description: "Asset details and definition" },
  { id: 2, title: "Configuration", icon: Settings, description: "Advanced settings and validation" },
  { id: 3, title: "Payment & Fees", icon: CreditCard, description: "Service fees and payment options" },
  { id: 4, title: "Review & Mint", icon: CheckCircle, description: "Final review and minting" }
];

// Token icons mapping
const TOKEN_ICONS: { [key: string]: string } = {
  "0x0000000000000000000000000000000000000000": "https://cryptologos.cc/logos/ethereum-eth-logo.png",
  "0x4200000000000000000000000000000000000006": "https://cryptologos.cc/logos/ethereum-eth-logo.png", // WETH
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": "https://cryptologos.cc/logos/usd-coin-usdc-logo.png", // USDC
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb": "https://cryptologos.cc/logos/dai-new-logo.png", // DAI
};

const MintForm = () => {
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

  // Fee calculation state
  const [whitelistedTokens, setWhitelistedTokens] = useState<Array<{ address: string; symbol: string; decimals: number; icon: string }>>([]);
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [serviceFee, setServiceFee] = useState<string>("0");
  const [commissionPercentage, setCommissionPercentage] = useState<string>("0");
  const [totalFee, setTotalFee] = useState<string>("0");
  const [isLoadingFees, setIsLoadingFees] = useState(false);
  const [fundManagerAddress, setFundManagerAddress] = useState<string>("");
  const [hasFundManager, setHasFundManager] = useState(false);

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
    
    // Payment & Fees (Step 3)
    token: "",
    usePaymentToken: false,
    useCustomValidator: false,
    useMetadataURI: false,
    useCustomSalt: false,
    salt: "",
    
    // Review (Step 4)
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

        // Use AppKit's transaction system
        const tx = await (walletProvider as any).request({
          method: 'eth_sendTransaction',
          params: [preparedTransaction]
        });

        console.log("Transaction executed successfully:", tx);
        setTxHash(tx);
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

    } catch (err) {
      console.error("Minting error:", err);
      
      // Check for specific smart account deployment errors
      const errorMessage = err instanceof Error ? err.message : "Failed to mint T-Deed. Please try again.";
      
      if (errorMessage.includes("smart account") || errorMessage.includes("deployment") || errorMessage.includes("not deployed")) {
        setError("Smart account deployment failed. Please try again or contact support.");
      } else if (errorMessage.includes("insufficient funds") || errorMessage.includes("gas")) {
        setError("Insufficient funds for transaction. Please ensure you have enough ETH for gas fees.");
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
                              <Coins className="w-5 h-5" />
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
                            <Separator className="bg-gray-200 dark:bg-gray-700" />
                            <div className="flex justify-between">
                              <span className="text-gray-900 dark:text-white font-semibold">Total:</span>
                              <span className="text-gray-900 dark:text-white font-semibold">
                                {formatTokenAmount(totalFee, 18)} {whitelistedTokens.find(t => t.address === selectedToken)?.symbol || "ETH"}
                              </span>
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
                <DollarSign className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No FundManager Configured</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  This T-Deed contract is not configured with a FundManager. Minting will proceed without payment processing.
                </p>
              </div>
            )}
          </div>
        );

      case 4:
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
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <main className="container mx-auto py-12 px-4">
      <NetworkWarning />
      
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
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
      </div>
    </main>
  );
};

export default MintForm;