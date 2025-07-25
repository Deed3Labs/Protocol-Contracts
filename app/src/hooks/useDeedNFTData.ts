import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useAccount, useChainId } from 'wagmi';
import DeedNFTJson from "@/contracts/DeedNFT.json";
import { useNetworkValidation } from './useNetworkValidation';
import { getContractAddressForNetwork, getRpcUrlForNetwork } from '@/config/networks';

export interface DeedNFT {
  tokenId: string;
  owner: string;
  assetType: number;
  uri: string;
  definition: string;
  configuration: string;
  validatorAddress: string;
  token: string;
  salt: string;
  isMinted: boolean;
}

export interface DeedNFTStats {
  totalDeedNFTs: number;
  userDeedNFTs: number;
  validatedDeedNFTs: number;
  pendingDeedNFTs: number;
  totalValue: string;
}

// Parse the ABI from the JSON string
const DEEDNFT_ABI = JSON.parse(DeedNFTJson.abi);

export const useDeedNFTData = () => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { isCorrectNetwork, currentNetwork } = useNetworkValidation();
  const [deedNFTs, setDeedNFTs] = useState<DeedNFT[]>([]);
  const [userDeedNFTs, setUserDeedNFTs] = useState<DeedNFT[]>([]);
  const [stats, setStats] = useState<DeedNFTStats>({
    totalDeedNFTs: 0,
    userDeedNFTs: 0,
    validatedDeedNFTs: 0,
    pendingDeedNFTs: 0,
    totalValue: "0"
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getContractAddress = () => {
    return getContractAddressForNetwork(chainId);
  };

  const getProvider = () => {
    // Try to use wallet provider first (for user interactions)
    if (window.ethereum) {
      console.log("Using wallet provider (window.ethereum)");
      return new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
    }
    
    // Fallback to dedicated RPC provider (for read-only operations)
    const rpcUrl = getRpcUrlForNetwork(chainId, true); // Prefer Alchemy
    console.log("Trying RPC URL:", rpcUrl);
    
    if (rpcUrl && rpcUrl !== 'https://mainnet.infura.io/v3/your-project-id' && 
        rpcUrl !== 'https://sepolia.infura.io/v3/your-project-id') {
      console.log("Using dedicated RPC provider");
      return new ethers.JsonRpcProvider(rpcUrl);
    }
    
    // Final fallback to public RPC
    const publicRpcUrl = getRpcUrlForNetwork(chainId, false);
    console.log("Using public RPC URL:", publicRpcUrl);
    if (publicRpcUrl) {
      return new ethers.JsonRpcProvider(publicRpcUrl);
    }
    
    throw new Error("No provider available for this network");
  };

  // Function to get DeedNFT data using available contract functions
  const getDeedNFTData = async (contract: ethers.Contract, tokenId: string): Promise<DeedNFT | null> => {
    try {
      console.log(`🔍 Fetching data for token ${tokenId}...`);
      
      // Get owner
      const owner = await contract.ownerOf(tokenId);
      console.log(`👤 Owner for token ${tokenId}: ${owner}`);
      
      // Get token URI for metadata
      const uri = await contract.tokenURI(tokenId);
      console.log(`🔗 URI for token ${tokenId}: ${uri}`);
      
      // Try to get validation status
      let validatorAddress = ethers.ZeroAddress;
      try {
        const [isValidated, validator] = await contract.getValidationStatus(tokenId);
        if (isValidated) {
          validatorAddress = validator;
        }
        console.log(`✅ Validation status for token ${tokenId}: ${isValidated}, validator: ${validator}`);
      } catch (err) {
        console.log(`❌ Could not get validation status for token ${tokenId}:`, err);
      }
      
      // Get asset type from contract traits
      let assetType = 0; // Default to Land
      try {
        // Get asset type from the trait storage
        const assetTypeKey = ethers.keccak256(ethers.toUtf8Bytes("assetType"));
        console.log(`🔑 Asset type key for token ${tokenId}: ${assetTypeKey}`);
        
        const assetTypeBytes = await contract.getTraitValue(tokenId, assetTypeKey);
        console.log(`📦 Asset type bytes for token ${tokenId}: ${assetTypeBytes}`);
        
        if (assetTypeBytes && assetTypeBytes.length > 0) {
          // Decode the asset type from bytes
          assetType = Number(ethers.AbiCoder.defaultAbiCoder().decode(["uint8"], assetTypeBytes)[0]);
          console.log(`🎯 Found asset type ${assetType} for token ${tokenId} from traits`);
        } else {
          console.log(`⚠️ No asset type trait found for token ${tokenId}, trying event fallback...`);
          
          // Try to get from DeedNFTMinted event as fallback
          try {
            const filter = contract.filters.DeedNFTMinted(tokenId);
            const events = await contract.queryFilter(filter);
            
            if (events.length > 0) {
              const event = events[0];
              if ('args' in event && event.args) {
                assetType = Number(event.args.assetType || 0);
                console.log(`🎯 Found asset type ${assetType} for token ${tokenId} from event`);
              }
            } else {
              console.log(`⚠️ No DeedNFTMinted event found for token ${tokenId}, using default asset type 0`);
            }
          } catch (eventErr) {
            console.log(`❌ Could not get asset type from event for token ${tokenId}:`, eventErr);
          }
        }
      } catch (err) {
        console.log(`❌ Could not get asset type for token ${tokenId}:`, err);
      }
      
      // Get definition from contract traits
      let definition = `DeedNFT #${tokenId}`;
      try {
        const definitionBytes = await contract.getTraitValue(tokenId, ethers.keccak256(ethers.toUtf8Bytes("definition")));
        if (definitionBytes && definitionBytes.length > 0) {
          definition = ethers.AbiCoder.defaultAbiCoder().decode(["string"], definitionBytes)[0];
          console.log(`📝 Found definition for token ${tokenId}: ${definition}`);
        }
      } catch (err) {
        console.log(`❌ Could not get definition for token ${tokenId}:`, err);
      }
      
      // Get configuration from contract traits
      let configuration = "";
      try {
        const configurationBytes = await contract.getTraitValue(tokenId, ethers.keccak256(ethers.toUtf8Bytes("configuration")));
        if (configurationBytes && configurationBytes.length > 0) {
          configuration = ethers.AbiCoder.defaultAbiCoder().decode(["string"], configurationBytes)[0];
          console.log(`⚙️ Found configuration for token ${tokenId}: ${configuration}`);
        }
      } catch (err) {
        console.log(`❌ Could not get configuration for token ${tokenId}:`, err);
      }
      
      const deedNFTData: DeedNFT = {
        tokenId,
        owner,
        assetType,
        uri,
        definition,
        configuration,
        validatorAddress,
        token: ethers.ZeroAddress, // Placeholder
        salt: "0", // Placeholder
        isMinted: true
      };
      
      console.log(`✅ Final DeedNFT data for token ${tokenId}:`, deedNFTData);
      return deedNFTData;
    } catch (err) {
      console.error(`❌ Error getting DeedNFT data for ${tokenId}:`, err);
      return null;
    }
  };

  // Debug function to test trait reading
  const debugTraits = async (contract: ethers.Contract, tokenId: string) => {
    try {
      console.log(`🔍 Debugging traits for token ${tokenId}...`);
      
      // Try to get all trait keys
      try {
        const traitKeys = await contract.getTraitKeys(tokenId);
        console.log(`🔑 All trait keys for token ${tokenId}:`, traitKeys);
        
        // Try to read each trait
        for (const traitKey of traitKeys) {
          try {
            const traitValue = await contract.getTraitValue(tokenId, traitKey);
            const traitName = await contract.getTraitName(traitKey);
            console.log(`📦 Trait "${traitName}" (${traitKey}): ${traitValue}`);
          } catch (err) {
            console.log(`❌ Could not read trait ${traitKey}:`, err);
          }
        }
      } catch (err) {
        console.log(`❌ Could not get trait keys for token ${tokenId}:`, err);
      }
      
      // Try specific trait keys we know should exist
      const knownKeys = [
        "assetType",
        "definition", 
        "configuration",
        "isValidated",
        "validator",
        "beneficiary"
      ];
      
      for (const key of knownKeys) {
        try {
          const traitKey = ethers.keccak256(ethers.toUtf8Bytes(key));
          const traitValue = await contract.getTraitValue(tokenId, traitKey);
          console.log(`🎯 Known trait "${key}" (${traitKey}): ${traitValue}`);
        } catch (err) {
          console.log(`❌ Could not read known trait "${key}":`, err);
        }
      }
      
    } catch (err) {
      console.error(`❌ Error debugging traits for token ${tokenId}:`, err);
    }
  };

  const fetchDeedNFTs = async () => {
    if (!isCorrectNetwork) {
      console.log('❌ Not connected to correct network');
      return;
    }

    const contractAddress = getContractAddress();
    if (!contractAddress) {
      console.log('❌ No contract address available');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      console.log(`🚀 Fetching DeedNFTs from contract ${contractAddress} on chain ${chainId}...`);
      
      const provider = getProvider();
      const contract = new ethers.Contract(contractAddress, DEEDNFT_ABI, provider);
      
      // Get total supply
      const totalSupply = await contract.totalSupply();
      console.log(`📊 Total supply: ${totalSupply}`);
      
      const deedNFTs: DeedNFT[] = [];
      
      // Fetch each token
      for (let i = 0; i < totalSupply; i++) {
        try {
          const tokenId = await contract.tokenByIndex(i);
          console.log(`🔍 Processing token ${tokenId} (index ${i})...`);
          
          // Debug traits for this token
          await debugTraits(contract, tokenId.toString());
          
          const deedNFTData = await getDeedNFTData(contract, tokenId.toString());
          if (deedNFTData) {
            deedNFTs.push(deedNFTData);
          }
        } catch (err) {
          console.error(`❌ Error processing token at index ${i}:`, err);
        }
      }
      
      console.log(`✅ Fetched ${deedNFTs.length} DeedNFTs:`, deedNFTs);
      setDeedNFTs(deedNFTs);
      
      // Filter user's DeedNFTs
      const userNFTs = deedNFTs.filter(deed => 
        deed.owner.toLowerCase() === address?.toLowerCase()
      );
      console.log(`👤 User's DeedNFTs (${userNFTs.length}):`, userNFTs);
      console.log(`🔍 Current user address: ${address}`);
      setUserDeedNFTs(userNFTs);
      
      // Calculate stats
      const stats: DeedNFTStats = {
        totalDeedNFTs: deedNFTs.length,
        userDeedNFTs: userNFTs.length,
        validatedDeedNFTs: deedNFTs.filter(deed => getValidationStatus(deed).status === "Validated").length,
        pendingDeedNFTs: deedNFTs.filter(deed => getValidationStatus(deed).status === "Pending").length,
        totalValue: "0" // Would need price oracle integration for real value
      };
      setStats(stats);
      
    } catch (err) {
      console.error('❌ Error fetching DeedNFTs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch DeedNFTs');
    } finally {
      setLoading(false);
    }
  };

  const getAssetTypeLabel = (assetType: number): string => {
    const types = ["Land", "Vehicle", "Estate", "Commercial Equipment"];
    return types[assetType] || "Unknown";
  };

  const getAssetTypeDescription = (assetType: number): string => {
    const descriptions = [
      "Real estate land parcels",
      "Automobiles and transport",
      "Complete property estates",
      "Business machinery and equipment"
    ];
    return descriptions[assetType] || "Unknown asset type";
  };

  const getValidationStatus = (deedNFT: DeedNFT): { status: string; color: string } => {
    if (deedNFT.validatorAddress !== ethers.ZeroAddress) {
      return { status: "Validated", color: "green" };
    }
    return { status: "Pending", color: "yellow" };
  };

  useEffect(() => {
    console.log("useEffect triggered:", { isConnected, isCorrectNetwork, address, chainId });
    
    if (isCorrectNetwork) {
      console.log("Network is correct, fetching DeedNFTs...");
      fetchDeedNFTs();
    } else {
      console.log("Network is not correct or not connected");
    }
  }, [isCorrectNetwork, address, chainId]); // Removed isConnected from dependency

  return {
    deedNFTs,
    userDeedNFTs,
    stats,
    loading,
    error,
    fetchDeedNFTs,
    getAssetTypeLabel,
    getAssetTypeDescription,
    getValidationStatus,
    isConnected,
    isCorrectNetwork,
    currentChainId: chainId,
    contractAddress: getContractAddress()
  };
}; 