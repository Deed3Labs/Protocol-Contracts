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
import DeedNFTJson from "@/contracts/DeedNFT.json";

// Extend Window interface for ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
    };
  }
}

const DEEDNFT_ADDRESS = DeedNFTJson.address;
const DEEDNFT_ABI = DeedNFTJson.abi;

const assetTypes = [
  { label: "Land", value: "0", description: "Real estate land parcels" },
  { label: "Vehicle", value: "1", description: "Automobiles and transport" },
  { label: "Estate", value: "2", description: "Complete property estates" },
  { label: "Commercial Equipment", value: "3", description: "Business machinery and equipment" },
];

const MintForm = () => {
  const [wallet, setWallet] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  // Form state
  const [form, setForm] = useState({
    owner: "",
    assetType: "0",
    uri: "",
    definition: "",
    configuration: "",
    validatorAddress: "",
    token: "",
    salt: ""
  });
  
  // Optional fields
  const [useCustomValidator, setUseCustomValidator] = useState(false);
  const [usePaymentToken, setUsePaymentToken] = useState(false);
  const [useCustomSalt, setUseCustomSalt] = useState(false);
  const [useMetadataURI, setUseMetadataURI] = useState(false);

  // Wallet connection
  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        setWallet(accounts[0]);
        setForm((f) => ({ ...f, owner: accounts[0] }));
        setError(null);
      } catch (err) {
        setError("Wallet connection failed");
      }
    } else {
      setError("MetaMask not detected");
    }
  };

  // Handle form input
  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  // Handle asset type select
  const handleAssetType = (value: string) => {
    setForm((f) => ({ ...f, assetType: value }));
  };

  // Mint function
  const handleMint = async () => {
    setIsLoading(true);
    setError(null);
    setTxHash(null);
    setSuccess(false);
    
    try {
      if (!window.ethereum) throw new Error("No wallet detected");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(DEEDNFT_ADDRESS, DEEDNFT_ABI, signer);
      
      const tx = await contract.mintAsset(
        form.owner,
        parseInt(form.assetType),
        useMetadataURI ? form.uri : "",
        form.definition,
        form.configuration,
        useCustomValidator ? form.validatorAddress : ethers.ZeroAddress,
        usePaymentToken ? form.token : ethers.ZeroAddress,
        useCustomSalt ? ethers.toBigInt(form.salt) : 0n
      );
      
      const receipt = await tx.wait();
      setTxHash(receipt.hash);
      setSuccess(true);
      
      // Reset form
      setForm({
        owner: form.owner, // Keep owner
        assetType: "0",
        uri: "",
        definition: "",
        configuration: "",
        validatorAddress: "",
        token: "",
        salt: ""
      });
      setUseCustomValidator(false);
      setUsePaymentToken(false);
      setUseCustomSalt(false);
      setUseMetadataURI(false);
      
    } catch (err: any) {
      setError(err.message || "Minting failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="container mx-auto py-12 px-4">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center">Mint Your DeedNFT</CardTitle>
          <CardDescription className="text-center text-lg">
            Create a new DeedNFT with customizable metadata and validation options.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Wallet Connection */}
          {!wallet ? (
            <div className="text-center">
              <Button onClick={connectWallet} size="lg" className="px-8">
                Connect Wallet
              </Button>
            </div>
          ) : (
            <>
              {/* Owner Address */}
              <div className="space-y-2">
                <Label htmlFor="owner">Owner Address</Label>
                <Input 
                  id="owner"
                  name="owner" 
                  value={form.owner} 
                  onChange={handleChange} 
                  disabled 
                  className="font-mono"
                />
              </div>

              <Separator />

              {/* Asset Type */}
              <div className="space-y-2">
                <Label htmlFor="assetType">Asset Type</Label>
                <Select value={form.assetType} onValueChange={handleAssetType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select asset type" />
                  </SelectTrigger>
                  <SelectContent>
                    {assetTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div>
                          <div className="font-medium">{type.label}</div>
                          <div className="text-sm text-muted-foreground">{type.description}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Definition (Required) */}
              <div className="space-y-2">
                <Label htmlFor="definition">Definition *</Label>
                <Textarea
                  id="definition"
                  name="definition"
                  value={form.definition}
                  onChange={handleChange}
                  placeholder="Describe the asset in detail..."
                  rows={3}
                  required
                />
              </div>

              {/* Configuration */}
              <div className="space-y-2">
                <Label htmlFor="configuration">Configuration</Label>
                <Textarea
                  id="configuration"
                  name="configuration"
                  value={form.configuration}
                  onChange={handleChange}
                  placeholder="Additional configuration details..."
                  rows={2}
                />
              </div>

              <Separator />

              {/* Optional Fields */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Optional Settings</h3>
                
                {/* Metadata URI */}
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="useMetadataURI"
                      checked={useMetadataURI}
                      onCheckedChange={(checked: boolean) => setUseMetadataURI(checked)}
                    />
                    <Label htmlFor="useMetadataURI">Add metadata URI</Label>
                  </div>
                  {useMetadataURI && (
                    <Input
                      name="uri"
                      value={form.uri}
                      onChange={handleChange}
                      placeholder="ipfs://... or https://..."
                    />
                  )}
                </div>

                {/* Custom Validator */}
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="useCustomValidator"
                      checked={useCustomValidator}
                      onCheckedChange={(checked: boolean) => setUseCustomValidator(checked)}
                    />
                    <Label htmlFor="useCustomValidator">Use custom validator</Label>
                  </div>
                  {useCustomValidator && (
                    <Input
                      name="validatorAddress"
                      value={form.validatorAddress}
                      onChange={handleChange}
                      placeholder="0x..."
                    />
                  )}
                </div>

                {/* Payment Token */}
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="usePaymentToken"
                      checked={usePaymentToken}
                      onCheckedChange={(checked: boolean) => setUsePaymentToken(checked)}
                    />
                    <Label htmlFor="usePaymentToken">Specify payment token</Label>
                  </div>
                  {usePaymentToken && (
                    <Input
                      name="token"
                      value={form.token}
                      onChange={handleChange}
                      placeholder="0x..."
                    />
                  )}
                </div>

                {/* Custom Salt */}
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="useCustomSalt"
                      checked={useCustomSalt}
                      onCheckedChange={(checked: boolean) => setUseCustomSalt(checked)}
                    />
                    <Label htmlFor="useCustomSalt">Use custom salt for token ID</Label>
                  </div>
                  {useCustomSalt && (
                    <Input
                      name="salt"
                      value={form.salt}
                      onChange={handleChange}
                      placeholder="0"
                      type="number"
                      min="0"
                    />
                  )}
                </div>
              </div>

              <Separator />

              {/* Mint Button */}
              <Button
                onClick={handleMint}
                disabled={isLoading || !form.definition.trim()}
                className="w-full"
                size="lg"
              >
                {isLoading ? 'Minting...' : 'Mint DeedNFT'}
              </Button>

              {/* Success Message */}
              {success && txHash && (
                <Alert>
                  <AlertDescription className="text-center">
                    Successfully minted! Transaction:{" "}
                    <a 
                      href={`https://sepolia.basescan.org/tx/${txHash}`} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="underline font-mono"
                    >
                      {txHash.slice(0, 10)}...{txHash.slice(-8)}
                    </a>
                  </AlertDescription>
                </Alert>
              )}

              {/* Error Message */}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
};

export default MintForm;