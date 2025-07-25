import React, { useState } from "react";
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
import { useAccount } from 'wagmi';
import DeedNFTJson from "@/contracts/DeedNFT.json";
import type { Eip1193Provider } from 'ethers';
import { NetworkWarning } from "@/components/NetworkWarning";
import { useNetworkValidation } from "@/hooks/useNetworkValidation";
import { ChevronRight, ChevronLeft, CheckCircle, AlertCircle, Wallet, FileText, Settings, CreditCard } from "lucide-react";

const DEEDNFT_ADDRESS = "0x1a4e89225015200f70e5a06f766399a3de6e21E6";
const DEEDNFT_ABI = DeedNFTJson.abi;

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

const MintForm = () => {
  const { address, isConnected } = useAccount();
  const { isCorrectNetwork } = useNetworkValidation();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      setError("Please provide a definition for your DeedNFT.");
      return;
    }

    if (!form.owner.trim()) {
      setError("Please provide an owner address for the DeedNFT.");
      return;
    }

    if (!ethers.isAddress(form.owner)) {
      setError("Please enter a valid Ethereum address for the owner.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      if (!window.ethereum) {
        throw new Error("No wallet detected. Please install MetaMask or another wallet.");
      }

      const provider = new ethers.BrowserProvider(window.ethereum as unknown as Eip1193Provider);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(DEEDNFT_ADDRESS, DEEDNFT_ABI, signer);

      // Prepare parameters matching DeedNFT.sol mintAsset function
      const owner = form.owner;
      const assetType = parseInt(form.assetType);
      const uri = form.useMetadataURI ? form.uri : "";
      const definition = form.definition;
      const configuration = form.configuration;
      const validatorAddress = form.useCustomValidator ? form.validatorAddress : ethers.ZeroAddress;
      const token = form.usePaymentToken ? form.token : ethers.ZeroAddress;
      const salt = form.useCustomSalt ? ethers.toBigInt(form.salt) : 0n;

      console.log("Minting DeedNFT with parameters:", {
        owner,
        assetType,
        uri,
        definition,
        configuration,
        validatorAddress,
        token,
        salt
      });

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
      setError(err instanceof Error ? err.message : "Failed to mint DeedNFT. Please try again.");
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

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="owner" className="text-gray-700 dark:text-gray-200 font-medium">Owner Address</Label>
              <Input
                id="owner"
                name="owner"
                value={form.owner}
                onChange={handleInputChange}
                placeholder="0x..."
                className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white font-mono"
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
                    className="text-xs border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
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

            <div className="space-y-2">
              <Label htmlFor="assetType" className="text-gray-700 dark:text-gray-200 font-medium">Asset Type</Label>
              <Select value={form.assetType} onValueChange={handleSelectChange}>
                <SelectTrigger className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white">
                  <SelectValue placeholder="Select asset type" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#141414] border-black/10 dark:border-white/10">
                  {assetTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value} className="text-gray-900 dark:text-white">
                      <div>
                        <div className="font-medium">{type.label}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">{type.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="definition" className="text-gray-700 dark:text-gray-200 font-medium">Definition *</Label>
              <Textarea
                id="definition"
                name="definition"
                value={form.definition}
                onChange={handleInputChange}
                placeholder="Describe the asset in detail..."
                rows={4}
                className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white"
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
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="useMetadataURI"
                  checked={form.useMetadataURI}
                  onCheckedChange={(checked) => handleCheckboxChange("useMetadataURI", checked)}
                  className="border-black/10 dark:border-white/10"
                />
                <Label htmlFor="useMetadataURI" className="text-gray-700 dark:text-gray-200 font-medium">
                  Add metadata URI
                </Label>
              </div>
              {form.useMetadataURI && (
                <Input
                  name="uri"
                  value={form.uri}
                  onChange={handleInputChange}
                  placeholder="ipfs://... or https://..."
                  className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white"
                />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="configuration" className="text-gray-700 dark:text-gray-200 font-medium">Configuration</Label>
              <Textarea
                id="configuration"
                name="configuration"
                value={form.configuration}
                onChange={handleInputChange}
                placeholder="Additional configuration details..."
                rows={3}
                className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white"
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="useCustomValidator"
                  checked={form.useCustomValidator}
                  onCheckedChange={(checked) => handleCheckboxChange("useCustomValidator", checked)}
                  className="border-black/10 dark:border-white/10"
                />
                <Label htmlFor="useCustomValidator" className="text-gray-700 dark:text-gray-200 font-medium">
                  Use custom validator
                </Label>
              </div>
              {form.useCustomValidator && (
                <Input
                  name="validatorAddress"
                  value={form.validatorAddress}
                  onChange={handleInputChange}
                  placeholder="0x..."
                  className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white"
                />
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="useCustomSalt"
                  checked={form.useCustomSalt}
                  onCheckedChange={(checked) => handleCheckboxChange("useCustomSalt", checked)}
                  className="border-black/10 dark:border-white/10"
                />
                <Label htmlFor="useCustomSalt" className="text-gray-700 dark:text-gray-200 font-medium">
                  Use custom salt for token ID
                </Label>
              </div>
              {form.useCustomSalt && (
                <Input
                  name="salt"
                  value={form.salt}
                  onChange={handleInputChange}
                  placeholder="0"
                  type="number"
                  min="0"
                  className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white"
                />
              )}
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="usePaymentToken"
                  checked={form.usePaymentToken}
                  onCheckedChange={(checked) => handleCheckboxChange("usePaymentToken", checked)}
                  className="border-black/10 dark:border-white/10"
                />
                <Label htmlFor="usePaymentToken" className="text-gray-700 dark:text-gray-200 font-medium">
                  Specify payment token (FundManager integration)
                </Label>
              </div>
              {form.usePaymentToken && (
                <Input
                  name="token"
                  value={form.token}
                  onChange={handleInputChange}
                  placeholder="0x..."
                  className="border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white"
                />
              )}
            </div>

            <Card className="border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-gray-900 dark:text-white">Fee Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-300">Service Fee:</span>
                  <span className="text-gray-900 dark:text-white font-medium">0.01 ETH</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-300">Commission:</span>
                  <span className="text-gray-900 dark:text-white font-medium">0.001 ETH</span>
                </div>
                <Separator className="bg-gray-200 dark:bg-gray-700" />
                <div className="flex justify-between">
                  <span className="text-gray-900 dark:text-white font-semibold">Total:</span>
                  <span className="text-gray-900 dark:text-white font-semibold">0.011 ETH</span>
                </div>
              </CardContent>
            </Card>
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
                </div>
              </CardContent>
            </Card>

            <Button
              onClick={handleMint}
              disabled={isLoading || !form.definition.trim() || !isCorrectNetwork}
              className="w-full text-lg font-semibold py-6 rounded-lg shadow-md bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white transition-colors duration-200"
              size="lg"
            >
              {isLoading ? 'Minting...' : 'Mint DeedNFT'}
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
                    <p>Please switch to a supported network to mint.</p>
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
                          DeedNFT minted successfully! Transaction hash: {txHash}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Navigation */}
                    <div className="flex justify-between pt-6">
                      <Button
                        onClick={prevStep}
                        disabled={currentStep === 1}
                        variant="outline"
                        className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                      >
                        <ChevronLeft className="w-4 h-4 mr-2" />
                        Previous
                      </Button>
                      
                      {currentStep < STEPS.length ? (
                        <Button
                          onClick={nextStep}
                          disabled={!form.definition.trim()}
                          className="bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white"
                        >
                          Next
                          <ChevronRight className="w-4 h-4 ml-2" />
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