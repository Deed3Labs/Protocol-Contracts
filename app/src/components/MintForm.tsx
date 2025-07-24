import { useState } from "react";
import { ethers } from "ethers";
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
    <div className="w-full flex items-center justify-center px-4">
      <div className="w-full max-w-xl bg-white dark:bg-card rounded-2xl shadow-xl p-10 flex flex-col items-center">
        <h1 className="text-3xl font-extrabold mb-4 text-center tracking-tight">Mint DeedNFT</h1>
        <p className="text-lg text-muted-foreground text-center mb-6">Mint a new DeedNFT asset onchain.</p>
        {!wallet ? (
          <Button className="w-full mb-4" onClick={connectWallet}>Connect Wallet</Button>
        ) : (
          <form onSubmit={handleMint} className="space-y-4 w-full">
            <div>
              <Label htmlFor="owner">Owner Address</Label>
              <Input name="owner" value={form.owner} onChange={handleChange} required disabled className="mt-1" />
            </div>
            <div>
              <Label htmlFor="assetType">Asset Type</Label>
              <Select value={form.assetType} onValueChange={handleAssetType}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select asset type" />
                </SelectTrigger>
                <SelectContent>
                  {assetTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="uri">Metadata URI (optional)</Label>
              <Input name="uri" value={form.uri} onChange={handleChange} placeholder="ipfs://..." className="mt-1" />
            </div>
            <div>
              <Label htmlFor="definition">Definition</Label>
              <Textarea name="definition" value={form.definition} onChange={handleChange} required className="mt-1" />
            </div>
            <div>
              <Label htmlFor="configuration">Configuration (optional)</Label>
              <Textarea name="configuration" value={form.configuration} onChange={handleChange} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="validatorAddress">Validator Address (optional)</Label>
              <Input name="validatorAddress" value={form.validatorAddress} onChange={handleChange} placeholder="0x..." className="mt-1" />
            </div>
            <div>
              <Label htmlFor="token">Payment Token Address (optional)</Label>
              <Input name="token" value={form.token} onChange={handleChange} placeholder="0x... or leave blank" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="salt">Salt (for custom tokenId, optional)</Label>
              <Input name="salt" value={form.salt} onChange={handleChange} placeholder="0 for auto" className="mt-1" type="number" min="0" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>{loading ? "Minting..." : "Mint"}</Button>
            {txHash && <div className="text-green-600 text-center">Minted! Tx: <a href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="underline">{txHash.slice(0, 10)}...</a></div>}
            {error && <div className="text-red-600 text-center">{error}</div>}
          </form>
        )}
      </div>
    </div>
  );
}

export default MintForm; 