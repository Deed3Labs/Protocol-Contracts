import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import { useAppKitAccount, useAppKitNetwork, useAppKitProvider } from '@reown/appkit/react';
import { useNetworkValidation } from "@/hooks/useNetworkValidation";
import { getContractAddressForNetwork, getRpcUrlForNetwork, getAbiPathForNetwork } from '@/config/networks';
import { EIP5792Utils } from '@/utils/EIP5792Utils';

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

interface DeedNFTContextType {
  deedNFTs: DeedNFT[];
  userDeedNFTs: DeedNFT[];
  stats: DeedNFTStats;
  loading: boolean;
  error: string | null;
  fetchDeedNFTs: () => Promise<void>;
  getAssetTypeLabel: (assetType: number) => string;
  getAssetTypeDescription: (assetType: number) => string;
  getValidationStatus: (deedNFT: DeedNFT) => { status: string; color: string };
  isConnected: boolean;
  isCorrectNetwork: boolean;
  currentChainId: number | undefined;
  contractAddress: string | null;
  address: string | undefined;
}

const DeedNFTContext = createContext<DeedNFTContextType | null>(null);

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

export const DeedNFTProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { address, isConnected, embeddedWalletInfo, status } = useAppKitAccount();
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

  const getContractAddress = useCallback(() => {
    if (!chainId) return null;
    return getContractAddressForNetwork(chainId);
  }, [chainId]);

  // Helper function to handle AppKit read operations with EIP-5792 support
  const executeAppKitCall = useCallback(async (
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
    
    try {
      // Try EIP-5792 first if supported
      const result = await EIP5792Utils.executeCall(
        walletProvider as any,
        contractAddress,
        data
      );
      
      console.log("AppKit call result (EIP-5792):", result);
      return result;
    } catch (error) {
      console.warn('EIP-5792 call failed, falling back to eth_call:', error);
      
      // Fallback to standard eth_call
      const result = await (walletProvider as any).request({
        method: 'eth_call',
        params: [{
          to: contractAddress,
          data
        }, 'latest']
      });

      console.log("AppKit call result (fallback):", result);
      return result;
    }
  }, [walletProvider, embeddedWalletInfo]);

  const getProvider = useCallback(() => {
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
  }, [walletProvider, embeddedWalletInfo, chainId]);

  // Function to get DeedNFT data using available contract functions
  const getDeedNFTData = useCallback(async (contractAddress: string, abi: any, tokenId: string): Promise<DeedNFT | null> => {
    try {
      console.log(`🔍 Fetching data for token ${tokenId}...`);
      
      if (!contractAddress) {
        throw new Error("No contract address available");
      }
      
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
        const provider = getProvider();
        const contract = new ethers.Contract(contractAddress, abi, provider);
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
          const provider = getProvider();
          const contract = new ethers.Contract(contractAddress, abi, provider);
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
          const provider = getProvider();
          const contract = new ethers.Contract(contractAddress, abi, provider);
          assetTypeBytes = await contract.getTraitValue(tokenId, assetTypeKey);
        }
        
        console.log(`📦 Asset type bytes for token ${tokenId}: ${assetTypeBytes}`);
        
        if (assetTypeBytes && assetTypeBytes.length > 0) {
          // Decode the asset type from bytes
          assetType = Number(ethers.AbiCoder.defaultAbiCoder().decode(["uint8"], assetTypeBytes)[0]);
          console.log(`🎯 Found asset type ${assetType} for token ${tokenId} from traits`);
        } else {
          console.log(`⚠️ No asset type trait found for token ${tokenId}, using default asset type 0`);
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
          const provider = getProvider();
          const contract = new ethers.Contract(contractAddress, abi, provider);
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
        if (walletProvider && embeddedWalletInfo) {
          const configurationResult = await executeAppKitCall(
            contractAddress,
            abi,
            'getTraitValue',
            [tokenId, ethers.keccak256(ethers.toUtf8Bytes("configuration"))]
          );
          const configurationBytes = new ethers.Interface(abi).decodeFunctionResult('getTraitValue', configurationResult)[0];
          if (configurationBytes && configurationBytes.length > 0) {
            configuration = ethers.AbiCoder.defaultAbiCoder().decode(["string"], configurationBytes)[0];
            console.log(`⚙️ Found configuration for token ${tokenId}: ${configuration}`);
          }
        } else {
          // Use traditional ethers.js for MetaMask
          const provider = getProvider();
          const contract = new ethers.Contract(contractAddress, abi, provider);
          const configurationBytes = await contract.getTraitValue(tokenId, ethers.keccak256(ethers.toUtf8Bytes("configuration")));
          if (configurationBytes && configurationBytes.length > 0) {
            configuration = ethers.AbiCoder.defaultAbiCoder().decode(["string"], configurationBytes)[0];
            console.log(`⚙️ Found configuration for token ${tokenId}: ${configuration}`);
          }
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
  }, [chainId, getContractAddress, executeAppKitCall, walletProvider, embeddedWalletInfo]);

  const fetchDeedNFTs = useCallback(async () => {
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
      
      const abi = await getDeedNFTAbi(chainId!);
      
      // Get total supply using EIP-5792 or fallback
      let totalSupply: bigint;
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit calls for totalSupply");
        const totalSupplyResult = await executeAppKitCall(
          contractAddress,
          abi,
          'totalSupply',
          []
        );
        totalSupply = new ethers.Interface(abi).decodeFunctionResult('totalSupply', totalSupplyResult)[0];
      } else {
        // Use traditional ethers.js for MetaMask
        const provider = getProvider();
        const contract = new ethers.Contract(contractAddress, abi, provider);
        totalSupply = await contract.totalSupply();
      }
      
      console.log(`📊 Total supply: ${totalSupply}`);
      
      const deedNFTs: DeedNFT[] = [];
      
      // Fetch each token
      for (let i = 0; i < totalSupply; i++) {
        try {
          let tokenId: bigint;
          
          if (walletProvider && embeddedWalletInfo) {
            console.log(`Using AppKit calls for tokenByIndex(${i})`);
            const tokenIdResult = await executeAppKitCall(
              contractAddress,
              abi,
              'tokenByIndex',
              [i]
            );
            tokenId = new ethers.Interface(abi).decodeFunctionResult('tokenByIndex', tokenIdResult)[0];
          } else {
            // Use traditional ethers.js for MetaMask
            const provider = getProvider();
            const contract = new ethers.Contract(contractAddress, abi, provider);
            tokenId = await contract.tokenByIndex(i);
          }
          
          console.log(`🔍 Processing token ${tokenId} (index ${i})...`);
          
          const deedNFTData = await getDeedNFTData(contractAddress, abi, tokenId.toString());
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
  }, [isCorrectNetwork, getContractAddress, chainId, address, walletProvider, embeddedWalletInfo, executeAppKitCall]);

  const getAssetTypeLabel = useCallback((assetType: number): string => {
    const types = ["Land", "Vehicle", "Estate", "Commercial Equipment"];
    return types[assetType] || "Unknown";
  }, []);

  const getAssetTypeDescription = useCallback((assetType: number): string => {
    const descriptions = [
      "Real estate land parcels",
      "Automobiles and transport",
      "Complete property estates",
      "Business machinery and equipment"
    ];
    return descriptions[assetType] || "Unknown asset type";
  }, []);

  const getValidationStatus = useCallback((deedNFT: DeedNFT): { status: string; color: string } => {
    if (deedNFT.validatorAddress !== ethers.ZeroAddress) {
      return { status: "Validated", color: "green" };
    }
    return { status: "Pending", color: "yellow" };
  }, []);

  // More accurate connection detection
  const isEmbeddedWalletConnected = Boolean(embeddedWalletInfo && embeddedWalletInfo.user && embeddedWalletInfo.user.email);
  const isRegularWalletConnected = Boolean(isConnected && address && status === 'connected');
  const isWalletConnected = isEmbeddedWalletConnected || isRegularWalletConnected;

  useEffect(() => {
    console.log("DeedNFTContext useEffect triggered:", { 
      isWalletConnected, 
      isCorrectNetwork, 
      address, 
      chainId,
      status,
      isEmbeddedWalletConnected,
      isRegularWalletConnected
    });
    
    if (isCorrectNetwork && isWalletConnected) {
      console.log("Network is correct and wallet is connected, fetching DeedNFTs...");
      fetchDeedNFTs();
    } else {
      console.log("Network is not correct or wallet is not connected, clearing data...");
      // Clear data when disconnected or wrong network
      setDeedNFTs([]);
      setUserDeedNFTs([]);
      setStats({
        totalDeedNFTs: 0,
        userDeedNFTs: 0,
        validatedDeedNFTs: 0,
        pendingDeedNFTs: 0,
        totalValue: "0"
      });
      setError(null);
    }
  }, [isCorrectNetwork, isWalletConnected, address, chainId, status]);

  const contextValue: DeedNFTContextType = {
    deedNFTs,
    userDeedNFTs,
    stats,
    loading,
    error,
    fetchDeedNFTs,
    getAssetTypeLabel,
    getAssetTypeDescription,
    getValidationStatus,
    isConnected: isWalletConnected,
    isCorrectNetwork,
    currentChainId: chainId,
    contractAddress: getContractAddress(),
    address
  };

  return (
    <DeedNFTContext.Provider value={contextValue}>
      {children}
    </DeedNFTContext.Provider>
  );
};

export const useDeedNFTContext = () => {
  const context = useContext(DeedNFTContext);
  if (!context) {
    throw new Error('useDeedNFTContext must be used within a DeedNFTProvider');
  }
  return context;
}; 