import { useState } from "react";
import { ethers } from "ethers";
import { Wallet, Coins, FileText, Settings, Zap, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import DeedNFTJson from "@/contracts/DeedNFT.json";

const DEEDNFT_ADDRESS = DeedNFTJson.address;
const DEEDNFT_ABI = DeedNFTJson.abi;

const assetTypes = [
  { label: "Land", value: "0" },
  { label: "Vehicle", value: "1" },
  { label: "Estate", value: "2" },
  { label: "Commercial Equipment", value: "3" },
];

function MintForm() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [step, setStep] = useState(1);
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
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Wallet connect
  const connectWallet = async () => {
    if (window.ethereum?.request) {
      try {
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        setWallet(accounts[0]);
        setForm((f) => ({ ...f, owner: accounts[0] }));
      } catch (err) {
        setError("Wallet connection failed");
      }
    } else {
      setError("MetaMask not detected or request method unavailable");
    }
  };

  // Handle form input
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  // Handle asset type select
  const handleAssetType = (value: string) => {
    setForm((f) => ({ ...f, assetType: value }));
  };

  // Mint function
  const handleMint = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setTxHash(null);
    try {
      if (!window.ethereum?.request) throw new Error("No wallet detected or request method unavailable");
      const provider = new ethers.BrowserProvider(window.ethereum as import('ethers').Eip1193Provider);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(DEEDNFT_ADDRESS, DEEDNFT_ABI, signer);
      const tx = await contract.mintAsset(
        form.owner,
        parseInt(form.assetType),
        form.uri,
        form.definition,
        form.configuration,
        form.validatorAddress || ethers.ZeroAddress,
        form.token || ethers.ZeroAddress,
        form.salt ? ethers.toBigInt(form.salt) : 0n
      );
      const receipt = await tx.wait();
      setTxHash(receipt.hash);
    } catch (err: any) {
      setError(err.message || "Minting failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-purple-50 dark:from-gray-950 dark:via-gray-900 dark:to-purple-950 transition-colors duration-500">
      <div className="container mx-auto px-6 py-12">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-sm font-medium mb-6 border border-purple-200 dark:border-purple-800">
              <Coins className="w-4 h-4 mr-2" />
              Asset Minting Platform
            </div>
            
            <h1 className="text-5xl font-bold bg-gradient-to-r from-gray-900 via-purple-800 to-blue-800 dark:from-white dark:via-purple-200 dark:to-blue-200 bg-clip-text text-transparent mb-4 leading-tight">
              Mint Your DeedNFT
            </h1>
            
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
              Transform your real-world assets into secure, verifiable digital tokens on the blockchain.
            </p>
          </div>
          
          {!wallet ? (
            /* Wallet Connection Section */
            <div className="max-w-md mx-auto">
              <div className="p-8 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-border text-center">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Wallet className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                </div>
                
                <h2 className="text-2xl font-semibold mb-4 text-foreground">Connect Your Wallet</h2>
                <p className="text-muted-foreground mb-6">
                  Connect your wallet to start minting DeedNFTs and managing your digital assets.
                </p>
                
                <Button 
                  onClick={connectWallet}
                  className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  Connect Wallet
                </Button>
              </div>
            </div>
          ) : (
            /* Minting Form */
            <div className="max-w-2xl mx-auto">
              {/* Progress Steps */}
              <div className="flex items-center justify-center mb-8">
                <div className="flex items-center space-x-4">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'} transition-colors duration-200`}>
                    {step > 1 ? <CheckCircle className="w-4 h-4" /> : '1'}
                  </div>
                  <div className={`w-12 h-0.5 ${step > 1 ? 'bg-blue-600' : 'bg-border'} transition-colors duration-200`}></div>
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'} transition-colors duration-200`}>
                    {step > 2 ? <CheckCircle className="w-4 h-4" /> : '2'}
                  </div>
                  <div className={`w-12 h-0.5 ${step > 2 ? 'bg-blue-600' : 'bg-border'} transition-colors duration-200`}></div>
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 3 ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'} transition-colors duration-200`}>
                    {step > 3 ? <CheckCircle className="w-4 h-4" /> : '3'}
                  </div>
                </div>
              </div>
              
              {/* Connected Wallet Info */}
              <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 mb-8">
                <div className="flex items-center">
                  <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">Wallet Connected</p>
                    <p className="text-xs text-green-600 dark:text-green-400 font-mono">{wallet.slice(0, 6)}...{wallet.slice(-4)}</p>
                  </div>
                </div>
              </div>
              
              <form onSubmit={handleMint} className="space-y-8">
                {/* Asset Information Section */}
                <div className="p-8 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-border">
                  <div className="flex items-center mb-6">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mr-4">
                      <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">Asset Information</h3>
                      <p className="text-sm text-muted-foreground">Define your asset type and basic details</p>
                    </div>
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <Label htmlFor="owner" className="text-sm font-medium text-foreground">Owner Address</Label>
                      <Input 
                        name="owner" 
                        value={form.owner} 
                        onChange={handleChange} 
                        required 
                        disabled 
                        className="mt-2 bg-muted" 
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="assetType" className="text-sm font-medium text-foreground">Asset Type</Label>
                      <Select value={form.assetType} onValueChange={handleAssetType}>
                        <SelectTrigger className="mt-2">
                          <SelectValue placeholder="Select asset type" />
                        </SelectTrigger>
                        <SelectContent>
                          {assetTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="md:col-span-2">
                      <Label htmlFor="uri" className="text-sm font-medium text-foreground">Metadata URI (optional)</Label>
                      <Input 
                        name="uri" 
                        value={form.uri} 
                        onChange={handleChange} 
                        placeholder="ipfs://..." 
                        className="mt-2" 
                      />
                    </div>
                  </div>
                </div>
                
                {/* Asset Details Section */}
                <div className="p-8 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-border">
                  <div className="flex items-center mb-6">
                    <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mr-4">
                      <Settings className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">Asset Details</h3>
                      <p className="text-sm text-muted-foreground">Provide detailed information about your asset</p>
                    </div>
                  </div>
                  
                  <div className="space-y-6">
                    <div>
                      <Label htmlFor="definition" className="text-sm font-medium text-foreground">Definition</Label>
                      <Textarea 
                        name="definition" 
                        value={form.definition} 
                        onChange={handleChange} 
                        required 
                        placeholder="Provide a detailed description of your asset..."
                        className="mt-2 min-h-[120px]" 
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="configuration" className="text-sm font-medium text-foreground">Configuration (optional)</Label>
                      <Textarea 
                        name="configuration" 
                        value={form.configuration} 
                        onChange={handleChange} 
                        placeholder="Additional configuration details..."
                        className="mt-2" 
                      />
                    </div>
                  </div>
                </div>
                
                {/* Advanced Settings Section */}
                <div className="p-8 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-border">
                  <div className="flex items-center mb-6">
                    <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center mr-4">
                      <Zap className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">Advanced Settings</h3>
                      <p className="text-sm text-muted-foreground">Optional validator and payment configuration</p>
                    </div>
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <Label htmlFor="validatorAddress" className="text-sm font-medium text-foreground">Validator Address (optional)</Label>
                      <Input 
                        name="validatorAddress" 
                        value={form.validatorAddress} 
                        onChange={handleChange} 
                        placeholder="0x..." 
                        className="mt-2" 
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="token" className="text-sm font-medium text-foreground">Payment Token Address (optional)</Label>
                      <Input 
                        name="token" 
                        value={form.token} 
                        onChange={handleChange} 
                        placeholder="0x... or leave blank" 
                        className="mt-2" 
                      />
                    </div>
                    
                    <div className="md:col-span-2">
                      <Label htmlFor="salt" className="text-sm font-medium text-foreground">Salt (for custom tokenId, optional)</Label>
                      <Input 
                        name="salt" 
                        value={form.salt} 
                        onChange={handleChange} 
                        placeholder="0 for auto" 
                        className="mt-2" 
                        type="number" 
                        min="0" 
                      />
                    </div>
                  </div>
                </div>
                
                {/* Submit Section */}
                <div className="text-center">
                  <Button 
                    type="submit" 
                    disabled={loading}
                    className="px-12 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                        Minting...
                      </>
                    ) : (
                      <>
                        <Coins className="w-4 h-4 mr-2" />
                        Mint DeedNFT
                      </>
                    )}
                  </Button>
                </div>
                
                {/* Status Messages */}
                {txHash && (
                  <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 mr-3" />
                      <div>
                        <p className="text-sm font-medium text-green-800 dark:text-green-200">Successfully Minted!</p>
                        <a 
                          href={`https://sepolia.basescan.org/tx/${txHash}`} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="text-xs text-green-600 dark:text-green-400 hover:underline font-mono"
                        >
                          {txHash.slice(0, 10)}...{txHash.slice(-8)}
                        </a>
                      </div>
                    </div>
                  </div>
                )}
                
                {error && (
                  <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                    <div className="flex items-center">
                      <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mr-3" />
                      <div>
                        <p className="text-sm font-medium text-red-800 dark:text-red-200">Minting Failed</p>
                        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                      </div>
                    </div>
                  </div>
                )}
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MintForm;