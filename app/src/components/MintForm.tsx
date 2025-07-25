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
import { useAccount } from 'wagmi';
import DeedNFTJson from "@/contracts/DeedNFT.json";
import type { Eip1193Provider } from 'ethers';
import { NetworkWarning } from "@/components/NetworkWarning";
import { useNetworkValidation } from "@/hooks/useNetworkValidation";

const DEEDNFT_ADDRESS = DeedNFTJson.address;
const DEEDNFT_ABI = DeedNFTJson.abi;

const assetTypes = [
  { label: "Land", value: "0", description: "Real estate land parcels" },
  { label: "Vehicle", value: "1", description: "Automobiles and transport" },
  { label: "Estate", value: "2", description: "Complete property estates" },
  { label: "Commercial Equipment", value: "3", description: "Business machinery and equipment" },
];

const MintForm = () => {
  const { address, isConnected } = useAccount();
  const { isCorrectNetwork } = useNetworkValidation();
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

  // Autofill owner when address changes
  React.useEffect(() => {
    if (address) {
      setForm((f) => ({ ...f, owner: address }));
    }
  }, [address]);

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
      const provider = new ethers.BrowserProvider(window.ethereum as unknown as Eip1193Provider);
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
      <NetworkWarning />
      <Card className="max-w-2xl mx-auto shadow-xl border border-border bg-card/90 animate-fade-in">
        <CardHeader className="pb-2">
          <CardTitle className="text-3xl font-bold text-center">Mint Your DeedNFT</CardTitle>
          <CardDescription className="text-center text-lg text-muted-foreground">
            Create a new DeedNFT with customizable metadata and validation options.
          </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-8 py-8">
          {/* Wallet Connection */}
          {!isConnected ? (
            <div className="text-center text-muted-foreground text-lg py-12">
              Please connect your wallet using the button in the header to mint.
            </div>
          ) : !isCorrectNetwork ? (
            <div className="text-center text-muted-foreground text-lg py-12">
              Please switch to a supported network to mint.
            </div>
          ) : (
            <form className="space-y-8" onSubmit={e => { e.preventDefault(); handleMint(); }}>
              {/* Owner Address */}
              <div className="space-y-2">
                <Label htmlFor="owner">Owner Address</Label>
                <Input
                  id="owner"
                  name="owner"
                  value={form.owner}
                  onChange={handleChange}
                  disabled
                  className="font-mono bg-muted/50"
                />
              </div>

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
                  className="bg-muted/50"
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
                  className="bg-muted/50"
                />
              </div>

              <Separator />

              {/* Optional Fields */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold mb-2">Optional Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                        className="bg-muted/50"
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
                        className="bg-muted/50"
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
                        className="bg-muted/50"
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
                        className="bg-muted/50"
                      />
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              {/* Mint Button */}
              <Button
                onClick={handleMint}
                disabled={isLoading || !form.definition.trim() || !isCorrectNetwork}
                className="w-full text-lg font-semibold py-6 rounded-lg shadow-md bg-primary text-primary-foreground hover:bg-primary/90 transition"
                size="lg"
              >
                {isLoading ? 'Minting...' : 'Mint DeedNFT'}
              </Button>

              {/* Success Message */}
              {success && txHash && (
                <Alert className="mt-6">
                  <AlertDescription className="text-center">
                    Successfully minted! Transaction: {" "}
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
                <Alert variant="destructive" className="mt-6">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
};

export default MintForm;