import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useAppKitAccount, useAppKitNetwork, useAppKitProvider } from '@reown/appkit/react';
import { useNetworkValidation } from './useNetworkValidation';
import { getContractAddressForNetwork, getRpcUrlForNetwork, getAbiPathForNetwork } from '@/config/networks';

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

// Dynamic ABI loading function
const getDeedNFTAbi = async (chainId: number) => {
  try {
    const abiPath = getAbiPathForNetwork(chainId, 'DeedNFT');
    const abiModule = await import(abiPath);
    return JSON.parse(abiModule.default.abi);
  } catch (error) {
    console.error('Error loading DeedNFT ABI:', error);
    // Fallback to base-sepolia
    const fallbackModule = await import('@/contracts/base-sepolia/DeedNFT.json');
    return JSON.parse(fallbackModule.default.abi);
  }
};

export const useDeedNFTData = () => {
  const { address, isConnected, embeddedWalletInfo } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider("eip155");
  const { isCorrectNetwork } = useNetworkValidation();
  
  // Derive chainId from caipNetworkId
  const chainId = caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
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
    if (!chainId) return null;
    return getContractAddressForNetwork(chainId);
  };

  // Helper function to handle AppKit read operations
  const executeAppKitCall = async (
    contractAddress: string,
    abi: any,
    functionName: string,
    params: any[]
  ) => {
    if (!walletProvider || !embeddedWalletInfo) {
      throw new Error("AppKit provider not available");
    }

    console.log(`Executing AppKit call: ${functionName}`, {
      contractAddress,
      params
    });

    const data = new ethers.Interface(abi).encodeFunctionData(functionName, params);
    
    const result = await (walletProvider as any).request({
      method: 'eth_call',
      params: [{
        to: contractAddress,
        data
      }, 'latest']
    });

    console.log("AppKit call result:", result);
    return result;
  };

  const getProvider = () => {
    // Use AppKit provider if available
    if (walletProvider && embeddedWalletInfo) {
      console.log("Using AppKit provider for read operations");
      return walletProvider as any;
    }
    
    // Try to use wallet provider first
    if (window.ethereum) {
      return new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
    }
    
    // Fallback to RPC provider
    if (!chainId) {
      throw new Error("No chain ID available");
    }
    
    const rpcUrl = getRpcUrlForNetwork(chainId);
    if (!rpcUrl) {
      throw new Error(`No RPC URL available for chain ${chainId}`);
    }
    
    return new ethers.JsonRpcProvider(rpcUrl);
  };

  // Function to get DeedNFT data using available contract functions
  const getDeedNFTData = async (contract: ethers.Contract, tokenId: string): Promise<DeedNFT | null> => {
    try {
      console.log(`🔍 Fetching data for token ${tokenId}...`);
      
      const contractAddress = getContractAddress();
      if (!contractAddress) {
        throw new Error("No contract address available");
      }
      
      const abi = await getDeedNFTAbi(chainId!);
      
      // Get owner
      let owner: string;
      let uri: string;
      
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit calls for read operations");
        
        // Get owner
        const ownerResult = await executeAppKitCall(
          contractAddress,
          abi,
          'ownerOf',
          [tokenId]
        );
        owner = new ethers.Interface(abi).decodeFunctionResult('ownerOf', ownerResult)[0];
        
        // Get token URI
        const uriResult = await executeAppKitCall(
          contractAddress,
          abi,
          'tokenURI',
          [tokenId]
        );
        uri = new ethers.Interface(abi).decodeFunctionResult('tokenURI', uriResult)[0];
      } else {
        // Use traditional ethers.js for MetaMask
        owner = await contract.ownerOf(tokenId);
        uri = await contract.tokenURI(tokenId);
      }
      
      console.log(`👤 Owner for token ${tokenId}: ${owner}`);
      console.log(`🔗 URI for token ${tokenId}: ${uri}`);
      
      // Try to get validation status
      let validatorAddress = ethers.ZeroAddress;
      try {
        let isValidated: boolean;
        let validator: string;
        
        if (walletProvider && embeddedWalletInfo) {
          const validationResult = await executeAppKitCall(
            contractAddress,
            abi,
            'getValidationStatus',
            [tokenId]
          );
          const decoded = new ethers.Interface(abi).decodeFunctionResult('getValidationStatus', validationResult);
          isValidated = decoded[0];
          validator = decoded[1];
        } else {
          // Use traditional ethers.js for MetaMask
          const [validationIsValidated, validationValidator] = await contract.getValidationStatus(tokenId);
          isValidated = validationIsValidated;
          validator = validationValidator;
        }
        
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
        
        let assetTypeBytes: string;
        
        if (walletProvider && embeddedWalletInfo) {
          const traitResult = await executeAppKitCall(
            contractAddress,
            abi,
            'getTraitValue',
            [tokenId, assetTypeKey]
          );
          assetTypeBytes = new ethers.Interface(abi).decodeFunctionResult('getTraitValue', traitResult)[0];
        } else {
          // Use traditional ethers.js for MetaMask
          assetTypeBytes = await contract.getTraitValue(tokenId, assetTypeKey);
        }
        
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
        let definitionBytes: string;
        
        if (walletProvider && embeddedWalletInfo) {
          const definitionResult = await executeAppKitCall(
            contractAddress,
            abi,
            'getTraitValue',
            [tokenId, ethers.keccak256(ethers.toUtf8Bytes("definition"))]
          );
          definitionBytes = new ethers.Interface(abi).decodeFunctionResult('getTraitValue', definitionResult)[0];
        } else {
          // Use traditional ethers.js for MetaMask
          definitionBytes = await contract.getTraitValue(tokenId, ethers.keccak256(ethers.toUtf8Bytes("definition")));
        }
        
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
      
      // Debug: Try to fetch metadata from the URI to see if it's working
      if (uri && uri.startsWith('data:application/json;base64,')) {
        try {
          const base64Data = uri.replace('data:application/json;base64,', '');
          const jsonData = atob(base64Data);
          const metadata = JSON.parse(jsonData);
          console.log(`📄 Metadata from URI for token ${tokenId}:`, metadata);
        } catch (metadataErr) {
          console.log(`❌ Could not parse metadata from URI for token ${tokenId}:`, metadataErr);
        }
      }
      
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
      const abi = await getDeedNFTAbi(chainId!);
      const contract = new ethers.Contract(contractAddress, abi, provider);
      
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