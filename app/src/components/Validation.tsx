import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Search, 
  Plus, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Eye, 
  Save,
  Shield,
  User,
  Hash,
  AlertCircle,
  RefreshCw
} from "lucide-react";
import { useAppKitAccount, useAppKitNetwork, useAppKitProvider } from "@reown/appkit/react";
import { ethers } from "ethers";
import { useDeedNFTData } from "@/hooks/useDeedNFTData";
import { getContractAddressForNetwork, getAbiPathForNetwork } from "@/config/networks";
import DeedNFTViewer from "./DeedNFTViewer";
import { EIP5792Utils } from "@/utils/EIP5792Utils";

// Dynamic ABI loading functions
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

const getValidatorAbi = async (chainId: number) => {
  try {
    const abiPath = getAbiPathForNetwork(chainId, 'Validator');
    const abiModule = await import(abiPath);
    return JSON.parse(abiModule.default.abi);
  } catch (error) {
    console.error('Error loading Validator ABI:', error);
    // Fallback to base-sepolia
    const fallbackModule = await import('@/contracts/base-sepolia/Validator.json');
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
    // Fallback to base-sepolia
    const fallbackModule = await import('@/contracts/base-sepolia/MetadataRenderer.json');
    return JSON.parse(fallbackModule.default.abi);
  }
};

interface ValidationPageProps {
  // Add any props if needed
}

interface TraitFormData {
  tokenId: string;
  traitName: string;
  traitValue: string;
  valueType: "string" | "number" | "boolean";
}

interface RemoveTraitFormData {
  tokenId: string;
  traitName: string;
}

interface UpdateTraitFormData {
  tokenId: string;
  traitName: string;
  traitValue: string;
  valueType: "string" | "number" | "boolean";
}

interface ValidationFormData {
  tokenId: string;
  isValid: boolean;
  notes: string;
}



interface DocumentFormData {
  tokenId: string;
  docType: string;
  documentURI: string;
  isRemove: boolean;
}

interface AssetConditionFormData {
  tokenId: string;
  generalCondition: string;
  lastInspectionDate: string;
  knownIssues: string[];
  improvements: string[];
  additionalNotes: string;
}

interface LegalInfoFormData {
  tokenId: string;
  jurisdiction: string;
  registrationNumber: string;
  registrationDate: string;
  documents: string[];
  restrictions: string[];
  additionalInfo: string;
}

interface FeaturesFormData {
  tokenId: string;
  features: string[];
}

interface GalleryFormData {
  tokenId: string;
  imageUrls: string[];
}

interface TraitNameFormData {
  traitKey: string;
  traitName: string;
}

interface DefinitionUpdateFormData {
  tokenId: string;
  definition: string;
  configuration: string;
}

const Validation: React.FC<ValidationPageProps> = () => {
  const { 
    address, 
    isConnected, 
    embeddedWalletInfo,
    status 
  } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider("eip155");
  
  // Use AppKit connection state - handle both regular wallets and embedded wallets
  const isWalletConnected = isConnected || (embeddedWalletInfo && status === 'connected');
  const walletAddress = address;
  const chainId = caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  
  const { 
    deedNFTs, 
    userDeedNFTs, 
    stats, 
    loading,
    error,
    fetchDeedNFTs,
    getAssetTypeLabel, 
    getValidationStatus,
    isCorrectNetwork,
    contractAddress
  } = useDeedNFTData();
  
  // State management
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterAssetType, setFilterAssetType] = useState("all");
  const [selectedDeedNFT, setSelectedDeedNFT] = useState<any>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0); // Add refresh key for forcing re-renders
  const [isRefreshing, setIsRefreshing] = useState(false); // Add refreshing state

  // Form states
  const [traitForm, setTraitForm] = useState<TraitFormData>({
    tokenId: "",
    traitName: "",
    traitValue: "",
    valueType: "string"
  });

  const [removeTraitForm, setRemoveTraitForm] = useState<RemoveTraitFormData>({
    tokenId: "",
    traitName: ""
  });

  const [updateTraitForm, setUpdateTraitForm] = useState<UpdateTraitFormData>({
    tokenId: "",
    traitName: "",
    traitValue: "",
    valueType: "string"
  });
  const [validationForm, setValidationForm] = useState<ValidationFormData>({
    tokenId: "",
    isValid: false,
    notes: ""
  });

  // Separate forms for each metadata function
  const [customMetadataForm, setCustomMetadataForm] = useState({
    tokenId: "",
    customMetadata: ""
  });

  const [animationURLForm, setAnimationURLForm] = useState({
    tokenId: "",
    animationURL: ""
  });

  const [externalLinkForm, setExternalLinkForm] = useState({
    tokenId: "",
    externalLink: ""
  });

  const [documentForm, setDocumentForm] = useState<DocumentFormData>({
    tokenId: "",
    docType: "",
    documentURI: "",
    isRemove: false
  });

  const [assetConditionForm, setAssetConditionForm] = useState<AssetConditionFormData>({
    tokenId: "",
    generalCondition: "",
    lastInspectionDate: "",
    knownIssues: [],
    improvements: [],
    additionalNotes: ""
  });

  const [legalInfoForm, setLegalInfoForm] = useState<LegalInfoFormData>({
    tokenId: "",
    jurisdiction: "",
    registrationNumber: "",
    registrationDate: "",
    documents: [],
    restrictions: [],
    additionalInfo: ""
  });

  const [featuresForm, setFeaturesForm] = useState<FeaturesFormData>({
    tokenId: "",
    features: []
  });

  const [galleryForm, setGalleryForm] = useState<GalleryFormData>({
    tokenId: "",
    imageUrls: []
  });

  const [traitNameForm, setTraitNameForm] = useState<TraitNameFormData>({
    traitKey: "",
    traitName: ""
  });

  const [definitionUpdateForm, setDefinitionUpdateForm] = useState<DefinitionUpdateFormData>({
    tokenId: "",
    definition: "",
    configuration: ""
  });

  // Contract interaction
  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [metadataRendererContract, setMetadataRendererContract] = useState<ethers.Contract | null>(null);

  // Function to get validator address from token traits
  const getValidatorAddressFromToken = async (tokenId: string): Promise<string | null> => {
    if (!chainId) return null;
    
    try {
      const contractAddress = getContractAddressForNetwork(chainId);
      if (!contractAddress) return null;
      
      const abi = await getDeedNFTAbi(chainId);
      
      // Get validator trait value using the trait key
      const validatorTraitKey = ethers.keccak256(ethers.toUtf8Bytes("validator"));
      let validatorBytes: string;
      
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit call for getTraitValue");
        const result = await executeAppKitCall(
          contractAddress,
          abi,
          'getTraitValue',
          [tokenId, validatorTraitKey]
        );
        // Decode the result (getTraitValue returns bytes)
        validatorBytes = new ethers.Interface(abi).decodeFunctionResult('getTraitValue', result)[0];
      } else {
        // Use traditional ethers.js for MetaMask
        if (!contract) {
          throw new Error("Contract not initialized");
        }
        validatorBytes = await contract.getTraitValue(tokenId, validatorTraitKey);
      }
      
      if (validatorBytes.length > 0) {
        // Decode the address from bytes
        const validatorAddress = ethers.AbiCoder.defaultAbiCoder().decode(['address'], validatorBytes)[0];
        console.log(`Validator address for token ${tokenId}:`, validatorAddress);
        return validatorAddress;
      }
      
      console.log(`No validator trait found for token ${tokenId}`);
      return null;
    } catch (error) {
      console.error(`Error getting validator address for token ${tokenId}:`, error);
      return null;
    }
  };

  // Function to initialize validator contract for a specific token
  const initializeValidatorContractForToken = async (tokenId: string): Promise<ethers.Contract | null> => {
    try {
      const validatorAddress = await getValidatorAddressFromToken(tokenId);
      
      if (!validatorAddress || validatorAddress === ethers.ZeroAddress) {
        console.warn(`No validator address found for token ${tokenId}`);
        return null;
      }

      // Initialize Validator contract
      if (!chainId) {
        console.error("Chain ID not available");
        return null;
      }
      console.log(`Loading Validator ABI for chainId: ${chainId}`);
      const validatorAbi = await getValidatorAbi(chainId);
      
      let signer;
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit provider for validator contract");
        signer = walletProvider as any;
      } else {
        console.log("Using MetaMask provider for validator contract");
        const provider = new ethers.BrowserProvider(window.ethereum as any);
        signer = await provider.getSigner();
      }
      
      const validatorContract = new ethers.Contract(validatorAddress, validatorAbi, signer);
      console.log(`Validator contract initialized for token ${tokenId} at address:`, validatorAddress);
      
      return validatorContract;
    } catch (error) {
      console.error(`Error initializing validator contract for token ${tokenId}:`, error);
      return null;
    }
  };

  // Clear success message after 5 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        setSuccess(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Debug connection state
  useEffect(() => {
    console.log('AppKit Connection State:', {
      isConnected,
      status,
      address,
      embeddedWalletInfo,
      isWalletConnected,
      isSmartAccountDeployed: embeddedWalletInfo?.isSmartAccountDeployed
    });
  }, [isConnected, status, address, embeddedWalletInfo, isWalletConnected]);

  // Initialize contracts
  useEffect(() => {
    if (chainId && isWalletConnected) {
      console.log("Chain ID:", chainId);
      const contractAddress = getContractAddressForNetwork(chainId);
      console.log("Contract address:", contractAddress);
      if (contractAddress && contractAddress !== "0x0000000000000000000000000000000000000000") {
        initializeContracts(contractAddress);
      } else {
        console.error("No valid contract address found for chainId:", chainId);
        setValidationError(`No valid contract address found for network ${chainId}. Please switch to a supported network.`);
      }
    }
  }, [chainId, isWalletConnected]);

  // Helper function to handle AppKit read operations with EIP-5792 support
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
  };

  // Helper function to handle AppKit transactions
  const executeAppKitTransaction = async (
    contractAddress: string,
    abi: any,
    functionName: string,
    params: any[]
  ) => {
    if (!walletProvider || !embeddedWalletInfo) {
      throw new Error("AppKit provider not available");
    }

    console.log(`Executing AppKit transaction: ${functionName}`, {
      contractAddress,
      params
    });

    const data = new ethers.Interface(abi).encodeFunctionData(functionName, params);
    
    const tx = await (walletProvider as any).request({
      method: 'eth_sendTransaction',
      params: [{
        to: contractAddress,
        data
      }]
    });

    console.log("AppKit transaction executed successfully:", tx);
    return tx;
  };

  const initializeContracts = async (contractAddress: string) => {
    try {
      console.log("Initializing contracts for address:", contractAddress);
      
      // Use AppKit provider if available (for embedded wallets), otherwise fallback to MetaMask
      let signer;
      
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit provider for embedded wallet");
        console.log("Smart account deployment status:", embeddedWalletInfo.isSmartAccountDeployed);
        console.log("Wallet provider:", walletProvider);
        
        // For embedded wallets, we need to use AppKit's transaction system
        // The walletProvider doesn't support direct ethers.js transactions
        // We'll use a different approach for read operations
        console.log("Using AppKit provider for read operations");
        
        // For read operations, we can use the provider directly
        // For write operations, we'll need to use AppKit's transaction system
        const provider = walletProvider as any;
        signer = provider;
      } else {
        console.log("Using MetaMask provider");
        const provider = new ethers.BrowserProvider(window.ethereum as any);
        signer = await provider.getSigner();
      }
      
      // Initialize DeedNFT contract
      if (!chainId) {
        console.error("Chain ID not available");
        return;
      }
      console.log("Loading DeedNFT ABI for chainId:", chainId);
      const deedNFTAbi = await getDeedNFTAbi(chainId);
      const deedNFTContract = new ethers.Contract(contractAddress, deedNFTAbi, signer);
      setContract(deedNFTContract);
      console.log("DeedNFT contract initialized");

      // Get MetadataRenderer address from the contract
      console.log("Getting MetadataRenderer address from DeedNFT contract");
      let metadataRendererAddress: string;
      
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit call for metadataRenderer");
        const result = await executeAppKitCall(
          contractAddress,
          deedNFTAbi,
          'metadataRenderer',
          []
        );
        // Decode the result (metadataRenderer returns an address)
        metadataRendererAddress = new ethers.Interface(deedNFTAbi).decodeFunctionResult('metadataRenderer', result)[0];
      } else {
        // Use traditional ethers.js for MetaMask
        metadataRendererAddress = await deedNFTContract.metadataRenderer();
      }
      
      console.log("MetadataRenderer address:", metadataRendererAddress);
      
      if (metadataRendererAddress && metadataRendererAddress !== ethers.ZeroAddress) {
        // Initialize MetadataRenderer contract
        console.log("Loading MetadataRenderer ABI for chainId:", chainId);
        const metadataRendererAbi = await getMetadataRendererAbi(chainId);
        const metadataRendererContract = new ethers.Contract(metadataRendererAddress, metadataRendererAbi, signer);
        setMetadataRendererContract(metadataRendererContract);
        console.log("MetadataRenderer contract initialized");
      } else {
        console.warn("No MetadataRenderer address found or address is zero");
      }
      
      console.log("All contracts initialized successfully");
    } catch (error) {
      console.error("Error initializing contracts:", error);
      setValidationError(`Failed to initialize contracts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Filter DeedNFTs
  const filteredDeedNFTs = deedNFTs.filter(deedNFT => {
    const matchesSearch = deedNFT.tokenId.toString().includes(searchTerm) ||
                         deedNFT.definition.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = filterStatus === "all" || 
                         (filterStatus === "validated" && getValidationStatus(deedNFT).status === "Validated") ||
                         (filterStatus === "pending" && getValidationStatus(deedNFT).status === "Pending");
    
    const matchesAssetType = filterAssetType === "all" || 
                            getAssetTypeLabel(deedNFT.assetType).toLowerCase() === filterAssetType.toLowerCase();
    
    return matchesSearch && matchesStatus && matchesAssetType;
  });

  // Check if user has validator permissions or is deed owner
  const checkValidatorPermissions = async (validatorContractToCheck?: ethers.Contract, tokenId?: string) => {
    if (!walletAddress) {
      console.log("No wallet address available");
      return false;
    }
    
    if (!chainId) {
      console.log("No chain ID available");
      return false;
    }
    
    const contractAddress = getContractAddressForNetwork(chainId);
    if (!contractAddress) {
      console.log("No contract address available");
      return false;
    }
    
    // First check if user is the deed owner
    if (tokenId) {
      try {
        let owner: string;
        
        if (walletProvider && embeddedWalletInfo) {
          console.log("Using AppKit call for ownerOf");
          const abi = await getDeedNFTAbi(chainId);
          const result = await executeAppKitCall(
            contractAddress,
            abi,
            'ownerOf',
            [tokenId]
          );
          // Decode the result (ownerOf returns an address)
          owner = new ethers.Interface(abi).decodeFunctionResult('ownerOf', result)[0];
        } else {
          // Use traditional ethers.js for MetaMask
          if (!contract) {
            throw new Error("Contract not initialized");
          }
          owner = await contract.ownerOf(tokenId);
        }
        
        if (owner.toLowerCase() === walletAddress.toLowerCase()) {
          console.log("User is the deed owner");
          return true;
        }
      } catch (error) {
        console.error("Error checking deed ownership:", error);
      }
    }
    
    // Check if user has VALIDATOR_ROLE on DeedNFT contract
    try {
      let deedNFTValidatorRole: string;
      let hasDeedNFTRole: boolean;
      
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit call for VALIDATOR_ROLE and hasRole");
        const abi = await getDeedNFTAbi(chainId);
        
        // Get VALIDATOR_ROLE
        const roleResult = await executeAppKitCall(
          contractAddress,
          abi,
          'VALIDATOR_ROLE',
          []
        );
        deedNFTValidatorRole = new ethers.Interface(abi).decodeFunctionResult('VALIDATOR_ROLE', roleResult)[0];
        
        // Check hasRole
        const hasRoleResult = await executeAppKitCall(
          contractAddress,
          abi,
          'hasRole',
          [deedNFTValidatorRole, walletAddress]
        );
        hasDeedNFTRole = new ethers.Interface(abi).decodeFunctionResult('hasRole', hasRoleResult)[0];
      } else {
        // Use traditional ethers.js for MetaMask
        if (!contract) {
          throw new Error("Contract not initialized");
        }
        deedNFTValidatorRole = await contract.VALIDATOR_ROLE();
        hasDeedNFTRole = await contract.hasRole(deedNFTValidatorRole, walletAddress);
      }
      
      if (hasDeedNFTRole) {
        console.log("User has VALIDATOR_ROLE on DeedNFT contract");
        return true;
      }
    } catch (error) {
      console.error("Error checking DeedNFT validator role:", error);
    }
    
    // Then check validator contract permissions
    if (!validatorContractToCheck) {
      console.log("No validator contract available");
      return false;
    }
    
    const contractToCheck = validatorContractToCheck;
    
    try {
      console.log("Checking validator permissions for address:", walletAddress);
      const VALIDATOR_ROLE = await contractToCheck.VALIDATOR_ROLE();
      console.log("VALIDATOR_ROLE:", VALIDATOR_ROLE);
      
      const hasRole = await contractToCheck.hasRole(VALIDATOR_ROLE, walletAddress);
      console.log("Has VALIDATOR_ROLE:", hasRole);
      
      // Also check if the user has the role on the MetadataRenderer contract
      if (metadataRendererContract) {
        const metadataRendererRole = await metadataRendererContract.VALIDATOR_ROLE();
        const hasMetadataRole = await metadataRendererContract.hasRole(metadataRendererRole, walletAddress);
        console.log("Has VALIDATOR_ROLE on MetadataRenderer:", hasMetadataRole);
        
        // User needs role on either contract
        return hasRole || hasMetadataRole;
      }
      
      return hasRole;
    } catch (error) {
      console.error("Error checking validator permissions:", error);
      return false;
    }
  };

  // Add trait to DeedNFT
  const handleAddTrait = async (tokenId: string) => {
    if (!contract || !traitForm.traitName || !traitForm.traitValue) {
      setValidationError("Please fill in all trait fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Get the validator contract for this specific token
      const tokenValidatorContract = await initializeValidatorContractForToken(tokenId);
      if (!tokenValidatorContract) {
        setValidationError("No validator found for this token");
        return;
      }

      const hasPermission = await checkValidatorPermissions(tokenValidatorContract, tokenId);
      if (!hasPermission) {
        setValidationError("You don't have permission to add traits");
        return;
      }

      // Convert trait value based on type
      let encodedValue: string;
      if (traitForm.valueType === "number") {
        encodedValue = ethers.zeroPadValue(ethers.toBeHex(parseInt(traitForm.traitValue)), 32);
      } else if (traitForm.valueType === "boolean") {
        encodedValue = ethers.zeroPadValue(ethers.toBeHex(traitForm.traitValue === "true" ? 1 : 0), 32);
      } else {
        encodedValue = ethers.toUtf8Bytes(traitForm.traitValue) as any;
      }

      // Use AppKit transaction system for embedded wallets
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit transaction system for setTrait");
        
        if (!chainId) {
          throw new Error("Chain ID not available");
        }
        
        const contractAddress = getContractAddressForNetwork(chainId);
        if (!contractAddress) {
          throw new Error("No contract address found for current network");
        }
        
        const abi = await getDeedNFTAbi(chainId);
        
        const tx = await executeAppKitTransaction(
          contractAddress,
          abi,
          'setTrait',
          [
            parseInt(tokenId),
            ethers.toUtf8Bytes(traitForm.traitName),
            encodedValue,
            traitForm.valueType === "string" ? 1 : traitForm.valueType === "number" ? 2 : 3
          ]
        );
        
        console.log("AppKit setTrait transaction executed:", tx);
      } else {
        // Use traditional ethers.js for MetaMask
        const tx = await contract.setTrait(
          parseInt(tokenId),
          ethers.toUtf8Bytes(traitForm.traitName),
          encodedValue,
          traitForm.valueType === "string" ? 1 : traitForm.valueType === "number" ? 2 : 3
        );

        await tx.wait();
      }
      setSuccess("Trait added successfully");
      setTraitForm({ tokenId: "", traitName: "", traitValue: "", valueType: "string" });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error adding trait:", error);
      setValidationError("Failed to add trait");
    } finally {
      setIsLoading(false);
    }
  };

  // Remove trait from DeedNFT
  const handleRemoveTrait = async (tokenId: string) => {
    if (!contract || !removeTraitForm.traitName) {
      setValidationError("Please fill in all trait fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Get the validator contract for this specific token
      const tokenValidatorContract = await initializeValidatorContractForToken(tokenId);
      if (!tokenValidatorContract) {
        setValidationError("No validator found for this token");
        return;
      }

      const hasPermission = await checkValidatorPermissions(tokenValidatorContract, tokenId);
      if (!hasPermission) {
        setValidationError("You don't have permission to remove traits");
        return;
      }

      console.log("Removing trait from token:", tokenId);
      console.log("Trait name:", removeTraitForm.traitName);

      // Use AppKit transaction system for embedded wallets
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit transaction system for removeTrait");
        
        if (!chainId) {
          throw new Error("Chain ID not available");
        }
        
        const contractAddress = getContractAddressForNetwork(chainId);
        if (!contractAddress) {
          throw new Error("No contract address found for current network");
        }
        
        const abi = await getDeedNFTAbi(chainId);
        
        const tx = await executeAppKitTransaction(
          contractAddress,
          abi,
          'removeTrait',
          [
            parseInt(tokenId),
            removeTraitForm.traitName
          ]
        );
        
        console.log("AppKit removeTrait transaction executed:", tx);
      } else {
        // Use traditional ethers.js for MetaMask
        const tx = await contract.removeTrait(
          parseInt(tokenId),
          removeTraitForm.traitName
        );

        await tx.wait();
      }
      setSuccess("Trait removed successfully");
      setRemoveTraitForm({ tokenId: "", traitName: "" });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error removing trait:", error);
      setValidationError("Failed to remove trait");
    } finally {
      setIsLoading(false);
    }
  };

  // Update trait value in DeedNFT
  const handleUpdateTrait = async (tokenId: string) => {
    if (!contract || !updateTraitForm.traitName || !updateTraitForm.traitValue) {
      setValidationError("Please fill in all trait fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Get the validator contract for this specific token
      const tokenValidatorContract = await initializeValidatorContractForToken(tokenId);
      if (!tokenValidatorContract) {
        setValidationError("No validator found for this token");
        return;
      }

      const hasPermission = await checkValidatorPermissions(tokenValidatorContract, tokenId);
      if (!hasPermission) {
        setValidationError("You don't have permission to update traits");
        return;
      }

      // Convert trait value based on type
      let encodedValue: string;
      if (updateTraitForm.valueType === "number") {
        encodedValue = ethers.zeroPadValue(ethers.toBeHex(parseInt(updateTraitForm.traitValue)), 32);
      } else if (updateTraitForm.valueType === "boolean") {
        encodedValue = ethers.zeroPadValue(ethers.toBeHex(updateTraitForm.traitValue === "true" ? 1 : 0), 32);
      } else {
        encodedValue = ethers.toUtf8Bytes(updateTraitForm.traitValue) as any;
      }

      console.log("Updating trait for token:", tokenId);
      console.log("Trait name:", updateTraitForm.traitName);
      console.log("New value:", updateTraitForm.traitValue);

      // Use AppKit transaction system for embedded wallets
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit transaction system for updateTrait");
        
        if (!chainId) {
          throw new Error("Chain ID not available");
        }
        
        const contractAddress = getContractAddressForNetwork(chainId);
        if (!contractAddress) {
          throw new Error("No contract address found for current network");
        }
        
        const abi = await getDeedNFTAbi(chainId);
        
        const tx = await executeAppKitTransaction(
          contractAddress,
          abi,
          'setTrait',
          [
            parseInt(tokenId),
            ethers.toUtf8Bytes(updateTraitForm.traitName),
            encodedValue,
            updateTraitForm.valueType === "string" ? 1 : updateTraitForm.valueType === "number" ? 2 : 3
          ]
        );
        
        console.log("AppKit updateTrait transaction executed:", tx);
      } else {
        // Use traditional ethers.js for MetaMask
        const tx = await contract.setTrait(
          parseInt(tokenId),
          ethers.toUtf8Bytes(updateTraitForm.traitName),
          encodedValue,
          updateTraitForm.valueType === "string" ? 1 : updateTraitForm.valueType === "number" ? 2 : 3
        );

        await tx.wait();
      }
      setSuccess("Trait updated successfully");
      setUpdateTraitForm({ tokenId: "", traitName: "", traitValue: "", valueType: "string" });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error updating trait:", error);
      setValidationError("Failed to update trait");
    } finally {
      setIsLoading(false);
    }
  };

  // Set trait name (Admin function)
  const handleSetTraitName = async () => {
    if (!contract || !traitNameForm.traitKey || !traitNameForm.traitName) {
      setValidationError("Please fill in all trait name fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null);

    try {
      // Check if user has DEFAULT_ADMIN_ROLE
      const hasAdminRole = await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), walletAddress);
      if (!hasAdminRole) {
        setValidationError("You don't have admin permissions to set trait names");
        return;
      }

      // Convert trait key to bytes32
      const traitKeyBytes32 = ethers.keccak256(ethers.toUtf8Bytes(traitNameForm.traitKey));

      // Use AppKit transaction system for embedded wallets
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit transaction system for setTraitName");
        
        if (!chainId) {
          throw new Error("Chain ID not available");
        }
        
        const contractAddress = getContractAddressForNetwork(chainId);
        if (!contractAddress) {
          throw new Error("No contract address found for current network");
        }
        
        const abi = await getDeedNFTAbi(chainId);
        
        const tx = await executeAppKitTransaction(
          contractAddress,
          abi,
          'setTraitName',
          [
            traitKeyBytes32,
            traitNameForm.traitName
          ]
        );
        
        console.log("AppKit setTraitName transaction executed:", tx);
      } else {
        // Use traditional ethers.js for MetaMask
        const tx = await contract.setTraitName(
          traitKeyBytes32,
          traitNameForm.traitName
        );

        await tx.wait();
      }
      setSuccess("Trait name set successfully");
      setTraitNameForm({ traitKey: "", traitName: "" });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1);
      }, 2000);
    } catch (error) {
      console.error("Error setting trait name:", error);
      setValidationError("Failed to set trait name");
    } finally {
      setIsLoading(false);
    }
  };

  // Get trait name
  const handleGetTraitName = async (traitKey: string) => {
    if (!contract) {
      setValidationError("DeedNFT contract not initialized");
      return "";
    }

    try {
      const traitKeyBytes32 = ethers.keccak256(ethers.toUtf8Bytes(traitKey));
      const traitName = await contract.getTraitName(traitKeyBytes32);
      console.log(`Trait name for key ${traitKey}:`, traitName);
      return traitName;
    } catch (error) {
      console.error("Error getting trait name:", error);
      return "";
    }
  };

  // Test trait name lookup (for debugging)
  const handleTestTraitName = async () => {
    if (!traitNameForm.traitKey) {
      setValidationError("Please enter a trait key to test");
      return;
    }

    const traitName = await handleGetTraitName(traitNameForm.traitKey);
    if (traitName) {
      setSuccess(`Trait name for "${traitNameForm.traitKey}": ${traitName}`);
    } else {
      setValidationError(`No trait name found for "${traitNameForm.traitKey}"`);
    }
  };

  // Update validation status
  const handleUpdateValidation = async (tokenId: string) => {
    if (!contract) {
      setValidationError("DeedNFT contract not initialized");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Check if user has VALIDATOR_ROLE on DeedNFT contract directly
      const hasDeedNFTRole = await contract.hasRole(await contract.VALIDATOR_ROLE(), walletAddress);
      
      if (hasDeedNFTRole) {
        // User has VALIDATOR_ROLE on DeedNFT, can call updateValidationStatus directly
        if (walletProvider && embeddedWalletInfo) {
          console.log("Using AppKit transaction system for updateValidationStatus");
          
          if (!chainId) {
            throw new Error("Chain ID not available");
          }
          
          const contractAddress = getContractAddressForNetwork(chainId);
          if (!contractAddress) {
            throw new Error("No contract address found for current network");
          }
          
          const abi = await getDeedNFTAbi(chainId);
          
          const tx = await executeAppKitTransaction(
            contractAddress,
            abi,
            'updateValidationStatus',
            [
              parseInt(tokenId),
              validationForm.isValid,
              walletAddress
            ]
          );
          
          console.log("AppKit updateValidationStatus transaction executed:", tx);
        } else {
          // Use traditional ethers.js for MetaMask
          const tx = await contract.updateValidationStatus(
            parseInt(tokenId),
            validationForm.isValid,
            walletAddress
          );
          await tx.wait();
        }
        setSuccess("Validation status updated successfully");
        setValidationForm({ tokenId: "", isValid: false, notes: "" });
      } else {
        // User doesn't have VALIDATOR_ROLE on DeedNFT, try using validator contract
        const tokenValidatorContract = await initializeValidatorContractForToken(tokenId);
        if (!tokenValidatorContract) {
          setValidationError("No validator found for this token and you don't have VALIDATOR_ROLE on DeedNFT");
          return;
        }

        // Check if user has VALIDATOR_ROLE on the validator contract
        const hasValidatorRole = await tokenValidatorContract.hasRole(await tokenValidatorContract.VALIDATOR_ROLE(), address);
        if (!hasValidatorRole) {
          setValidationError("You don't have VALIDATOR_ROLE on either the DeedNFT or the validator contract");
          return;
        }

        // Call validateDeed on the validator contract, which will update the status
        if (walletProvider && embeddedWalletInfo) {
          console.log("Using AppKit transaction system for validateDeed");
          
          // Get validator contract address
          const validatorAddress = await getValidatorAddressFromToken(tokenId);
          if (!validatorAddress) {
            throw new Error("No validator address found for token");
          }
          
          const validatorAbi = await getValidatorAbi(chainId!);
          
          const tx = await executeAppKitTransaction(
            validatorAddress,
            validatorAbi,
            'validateDeed',
            [parseInt(tokenId)]
          );
          
          console.log("AppKit validateDeed transaction executed:", tx);
        } else {
          // Use traditional ethers.js for MetaMask
          const tx = await tokenValidatorContract.validateDeed(parseInt(tokenId));
          await tx.wait();
        }
        setSuccess("Deed validated successfully");
        setValidationForm({ tokenId: "", isValid: false, notes: "" });
      }
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error updating validation:", error);
      setValidationError("Failed to update validation status");
    } finally {
      setIsLoading(false);
    }
  };

  // Validate deed using validator contract
  const handleValidateDeed = async (tokenId: string) => {
    if (!contract) {
      setValidationError("DeedNFT contract not initialized");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Check if user has VALIDATOR_ROLE on DeedNFT contract directly
      const hasDeedNFTRole = await contract.hasRole(await contract.VALIDATOR_ROLE(), walletAddress);
      
      if (hasDeedNFTRole) {
        // User has VALIDATOR_ROLE on DeedNFT, can call updateValidationStatus directly
        if (walletProvider && embeddedWalletInfo) {
          console.log("Using AppKit transaction system for updateValidationStatus (validate)");
          
          if (!chainId) {
            throw new Error("Chain ID not available");
          }
          
          const contractAddress = getContractAddressForNetwork(chainId);
          if (!contractAddress) {
            throw new Error("No contract address found for current network");
          }
          
          const abi = await getDeedNFTAbi(chainId);
          
          const tx = await executeAppKitTransaction(
            contractAddress,
            abi,
            'updateValidationStatus',
            [
              parseInt(tokenId),
              true, // Set as validated
              walletAddress
            ]
          );
          
          console.log("AppKit updateValidationStatus (validate) transaction executed:", tx);
        } else {
          // Use traditional ethers.js for MetaMask
          const tx = await contract.updateValidationStatus(
            parseInt(tokenId),
            true, // Set as validated
            walletAddress
          );
          await tx.wait();
        }
        setSuccess("Deed validated successfully");
      } else {
        // User doesn't have VALIDATOR_ROLE on DeedNFT, try using validator contract
        const tokenValidatorContract = await initializeValidatorContractForToken(tokenId);
        if (!tokenValidatorContract) {
          setValidationError("No validator found for this token and you don't have VALIDATOR_ROLE on DeedNFT");
          return;
        }

        // Check if user has VALIDATOR_ROLE on the validator contract
        const hasValidatorRole = await tokenValidatorContract.hasRole(await tokenValidatorContract.VALIDATOR_ROLE(), address);
        if (!hasValidatorRole) {
          setValidationError("You don't have VALIDATOR_ROLE on either the DeedNFT or the validator contract");
          return;
        }

        // Call validateDeed on the validator contract, which will update the status
        if (walletProvider && embeddedWalletInfo) {
          console.log("Using AppKit transaction system for validateDeed (validate)");
          
          // Get validator contract address
          const validatorAddress = await getValidatorAddressFromToken(tokenId);
          if (!validatorAddress) {
            throw new Error("No validator address found for token");
          }
          
          const validatorAbi = await getValidatorAbi(chainId!);
          
          const tx = await executeAppKitTransaction(
            validatorAddress,
            validatorAbi,
            'validateDeed',
            [parseInt(tokenId)]
          );
          
          console.log("AppKit validateDeed (validate) transaction executed:", tx);
        } else {
          // Use traditional ethers.js for MetaMask
          const tx = await tokenValidatorContract.validateDeed(parseInt(tokenId));
          await tx.wait();
        }
        setSuccess("Deed validated successfully");
      }
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error validating deed:", error);
      setValidationError("Failed to validate deed");
    } finally {
      setIsLoading(false);
    }
  };

  // Metadata management functions - each calls its own specific function
  const handleSetCustomMetadata = async () => {
    if (!metadataRendererContract || !customMetadataForm.tokenId || !customMetadataForm.customMetadata) {
      setValidationError("Please fill in all required fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Get the validator contract for this specific token
      const tokenValidatorContract = await initializeValidatorContractForToken(customMetadataForm.tokenId);
      if (!tokenValidatorContract) {
        setValidationError("No validator found for this token");
        return;
      }

      const hasPermission = await checkValidatorPermissions(tokenValidatorContract, customMetadataForm.tokenId);
      if (!hasPermission) {
        setValidationError("You don't have permission to update metadata. You need VALIDATOR_ROLE or be the deed owner.");
        return;
      }

      console.log("Setting custom metadata for token:", customMetadataForm.tokenId);
      console.log("Metadata:", customMetadataForm.customMetadata);

      // Call the specific function: setTokenCustomMetadata(uint256 tokenId, string metadata)
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit transaction system for setTokenCustomMetadata");
        
        if (!chainId) {
          throw new Error("Chain ID not available");
        }
        
        // Get MetadataRenderer contract address
        const metadataRendererAddress = await contract!.metadataRenderer();
        if (!metadataRendererAddress || metadataRendererAddress === ethers.ZeroAddress) {
          throw new Error("No MetadataRenderer address found");
        }
        
        const metadataRendererAbi = await getMetadataRendererAbi(chainId);
        
        const tx = await executeAppKitTransaction(
          metadataRendererAddress,
          metadataRendererAbi,
          'setTokenCustomMetadata',
          [
            parseInt(customMetadataForm.tokenId),
            customMetadataForm.customMetadata
          ]
        );
        
        console.log("AppKit setTokenCustomMetadata transaction executed:", tx);
      } else {
        // Use traditional ethers.js for MetaMask
        const tx = await metadataRendererContract.setTokenCustomMetadata(
          parseInt(customMetadataForm.tokenId),
          customMetadataForm.customMetadata
        );

        console.log("Transaction sent:", tx.hash);
        await tx.wait();
        console.log("Transaction confirmed");
      }
      
      setSuccess("Custom metadata updated successfully");
      setCustomMetadataForm({ tokenId: "", customMetadata: "" });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error updating custom metadata:", error);
      setValidationError(`Failed to update custom metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetAnimationURL = async () => {
    if (!metadataRendererContract || !animationURLForm.tokenId || !animationURLForm.animationURL) {
      setValidationError("Please fill in all required fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Get the validator contract for this specific token
      const tokenValidatorContract = await initializeValidatorContractForToken(animationURLForm.tokenId);
      if (!tokenValidatorContract) {
        setValidationError("No validator found for this token");
        return;
      }

      const hasPermission = await checkValidatorPermissions(tokenValidatorContract, animationURLForm.tokenId);
      if (!hasPermission) {
        setValidationError("You don't have permission to update metadata. You need VALIDATOR_ROLE or be the deed owner.");
        return;
      }

      console.log("Setting animation URL for token:", animationURLForm.tokenId);
      console.log("Animation URL:", animationURLForm.animationURL);

      // Call the specific function: setTokenAnimationURL(uint256 tokenId, string animationURL)
      const tx = await metadataRendererContract.setTokenAnimationURL(
        parseInt(animationURLForm.tokenId),
        animationURLForm.animationURL
      );

      console.log("Transaction sent:", tx.hash);
      await tx.wait();
      console.log("Transaction confirmed");
      
      setSuccess("Animation URL updated successfully");
      setAnimationURLForm({ tokenId: "", animationURL: "" });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error updating animation URL:", error);
      setValidationError(`Failed to update animation URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetExternalLink = async () => {
    if (!metadataRendererContract || !externalLinkForm.tokenId || !externalLinkForm.externalLink) {
      setValidationError("Please fill in all required fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Get the validator contract for this specific token
      const tokenValidatorContract = await initializeValidatorContractForToken(externalLinkForm.tokenId);
      if (!tokenValidatorContract) {
        setValidationError("No validator found for this token");
        return;
      }

      const hasPermission = await checkValidatorPermissions(tokenValidatorContract, externalLinkForm.tokenId);
      if (!hasPermission) {
        setValidationError("You don't have permission to update metadata. You need VALIDATOR_ROLE or be the deed owner.");
        return;
      }

      console.log("Setting external link for token:", externalLinkForm.tokenId);
      console.log("External link:", externalLinkForm.externalLink);

      // Call the specific function: setTokenExternalLink(uint256 tokenId, string externalLink)
      const tx = await metadataRendererContract.setTokenExternalLink(
        parseInt(externalLinkForm.tokenId),
        externalLinkForm.externalLink
      );

      console.log("Transaction sent:", tx.hash);
      await tx.wait();
      console.log("Transaction confirmed");
      
      setSuccess("External link updated successfully");
      setExternalLinkForm({ tokenId: "", externalLink: "" });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error updating external link:", error);
      setValidationError(`Failed to update external link: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Document management
  const handleManageDocument = async () => {
    if (!metadataRendererContract || !documentForm.tokenId || !documentForm.docType) {
      setValidationError("Please fill in all required fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Get the validator contract for this specific token
      const tokenValidatorContract = await initializeValidatorContractForToken(documentForm.tokenId);
      if (!tokenValidatorContract) {
        setValidationError("No validator found for this token");
        return;
      }

      const hasPermission = await checkValidatorPermissions(tokenValidatorContract, documentForm.tokenId);
      if (!hasPermission) {
        setValidationError("You don't have permission to manage documents");
        return;
      }

      // Call the specific function: manageTokenDocument(uint256 tokenId, string docType, string documentURI, bool isRemove)
      const tx = await metadataRendererContract.manageTokenDocument(
        parseInt(documentForm.tokenId),
        documentForm.docType,
        documentForm.documentURI,
        documentForm.isRemove
      );

      await tx.wait();
      setSuccess(documentForm.isRemove ? "Document removed successfully" : "Document added successfully");
      setDocumentForm({ tokenId: "", docType: "", documentURI: "", isRemove: false });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error managing document:", error);
      setValidationError("Failed to manage document");
    } finally {
      setIsLoading(false);
    }
  };

  // Asset condition management
  const handleSetAssetCondition = async () => {
    if (!metadataRendererContract || !assetConditionForm.tokenId || !assetConditionForm.generalCondition) {
      setValidationError("Please fill in all required fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Get the validator contract for this specific token
      const tokenValidatorContract = await initializeValidatorContractForToken(assetConditionForm.tokenId);
      if (!tokenValidatorContract) {
        setValidationError("No validator found for this token");
        return;
      }

      const hasPermission = await checkValidatorPermissions(tokenValidatorContract, assetConditionForm.tokenId);
      if (!hasPermission) {
        setValidationError("You don't have permission to update asset condition");
        return;
      }

      // Call the specific function: setAssetCondition(uint256 tokenId, string generalCondition, string lastInspectionDate, string[] knownIssues, string[] improvements, string additionalNotes)
      const tx = await metadataRendererContract.setAssetCondition(
        parseInt(assetConditionForm.tokenId),
        assetConditionForm.generalCondition,
        assetConditionForm.lastInspectionDate,
        assetConditionForm.knownIssues,
        assetConditionForm.improvements,
        assetConditionForm.additionalNotes
      );

      await tx.wait();
      setSuccess("Asset condition updated successfully");
      setAssetConditionForm({
        tokenId: "",
        generalCondition: "",
        lastInspectionDate: "",
        knownIssues: [],
        improvements: [],
        additionalNotes: ""
      });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error updating asset condition:", error);
      setValidationError("Failed to update asset condition");
    } finally {
      setIsLoading(false);
    }
  };

  // Legal info management
  const handleSetLegalInfo = async () => {
    if (!metadataRendererContract || !legalInfoForm.tokenId || !legalInfoForm.jurisdiction) {
      setValidationError("Please fill in all required fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Get the validator contract for this specific token
      const tokenValidatorContract = await initializeValidatorContractForToken(legalInfoForm.tokenId);
      if (!tokenValidatorContract) {
        setValidationError("No validator found for this token");
        return;
      }

      const hasPermission = await checkValidatorPermissions(tokenValidatorContract, legalInfoForm.tokenId);
      if (!hasPermission) {
        setValidationError("You don't have permission to update legal info");
        return;
      }

      // Call the specific function: setTokenLegalInfo(uint256 tokenId, string jurisdiction, string registrationNumber, string registrationDate, string[] documents, string[] restrictions, string additionalInfo)
      const tx = await metadataRendererContract.setTokenLegalInfo(
        parseInt(legalInfoForm.tokenId),
        legalInfoForm.jurisdiction,
        legalInfoForm.registrationNumber,
        legalInfoForm.registrationDate,
        legalInfoForm.documents,
        legalInfoForm.restrictions,
        legalInfoForm.additionalInfo
      );

      await tx.wait();
      setSuccess("Legal info updated successfully");
      setLegalInfoForm({
        tokenId: "",
        jurisdiction: "",
        registrationNumber: "",
        registrationDate: "",
        documents: [],
        restrictions: [],
        additionalInfo: ""
      });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error updating legal info:", error);
      setValidationError("Failed to update legal info");
    } finally {
      setIsLoading(false);
    }
  };

  // Features management
  const handleSetFeatures = async () => {
    if (!metadataRendererContract || !featuresForm.tokenId || featuresForm.features.length === 0) {
      setValidationError("Please fill in all required fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Get the validator contract for this specific token
      const tokenValidatorContract = await initializeValidatorContractForToken(featuresForm.tokenId);
      if (!tokenValidatorContract) {
        setValidationError("No validator found for this token");
        return;
      }

      const hasPermission = await checkValidatorPermissions(tokenValidatorContract, featuresForm.tokenId);
      if (!hasPermission) {
        setValidationError("You don't have permission to update features");
        return;
      }

      // Call the specific function: setTokenFeatures(uint256 tokenId, string[] features)
      const tx = await metadataRendererContract.setTokenFeatures(
        parseInt(featuresForm.tokenId),
        featuresForm.features
      );

      await tx.wait();
      setSuccess("Features updated successfully");
      setFeaturesForm({ tokenId: "", features: [] });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error updating features:", error);
      setValidationError("Failed to update features");
    } finally {
      setIsLoading(false);
    }
  };

  // Gallery management
  const handleSetGallery = async () => {
    if (!metadataRendererContract || !galleryForm.tokenId || galleryForm.imageUrls.length === 0) {
      setValidationError("Please fill in all required fields");
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setSuccess(null); // Clear previous success message

    try {
      // Get the validator contract for this specific token
      const tokenValidatorContract = await initializeValidatorContractForToken(galleryForm.tokenId);
      if (!tokenValidatorContract) {
        setValidationError("No validator found for this token");
        return;
      }

      const hasPermission = await checkValidatorPermissions(tokenValidatorContract, galleryForm.tokenId);
      if (!hasPermission) {
        setValidationError("You don't have permission to update gallery");
        return;
      }

      // Call the specific function: setTokenGallery(uint256 tokenId, string[] imageUrls)
      const tx = await metadataRendererContract.setTokenGallery(
        parseInt(galleryForm.tokenId),
        galleryForm.imageUrls
      );

      await tx.wait();
      setSuccess("Gallery updated successfully");
      setGalleryForm({ tokenId: "", imageUrls: [] });
      
      // Wait a moment for blockchain state to update, then refresh data
      setTimeout(() => {
        setIsRefreshing(true);
        fetchDeedNFTs().finally(() => {
          setIsRefreshing(false);
        });
        setRefreshKey(prev => prev + 1); // Increment refresh key
      }, 2000);
    } catch (error) {
      console.error("Error updating gallery:", error);
      setValidationError("Failed to update gallery");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateDefinition = async () => {
    if (!chainId || !contract) {
      setValidationError("Contract not initialized");
      return;
    }

    setIsLoading(true);
    setValidationError(null);

    try {
      const tokenId = parseInt(definitionUpdateForm.tokenId);
      if (isNaN(tokenId)) {
        throw new Error("Invalid token ID");
      }

      if (!definitionUpdateForm.definition.trim()) {
        throw new Error("Definition cannot be empty");
      }

      console.log(`Updating definition for token ${tokenId}:`, {
        definition: definitionUpdateForm.definition,
        configuration: definitionUpdateForm.configuration
      });

      // Get the contract address and ABI for the current chain
      const contractAddress = getContractAddressForNetwork(chainId);
      if (!contractAddress) {
        throw new Error("No contract address found for current network");
      }
      const deedNFTAbi = await getDeedNFTAbi(chainId);

      // Use the setTrait function to update individual traits
      // This allows updating just the definition without requiring all metadata fields
      
      // Update definition trait
      const definitionTraitKey = ethers.keccak256(ethers.toUtf8Bytes("definition"));
      const definitionValue = ethers.toUtf8Bytes(definitionUpdateForm.definition);
      
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit transaction for setTrait (definition)");
        const result = await executeAppKitTransaction(
          contractAddress,
          deedNFTAbi,
          'setTrait',
          [tokenId, definitionTraitKey, definitionValue, 1] // 1 = string type
        );
        console.log("Definition updated successfully:", result);
      } else {
        console.log("Using MetaMask transaction for setTrait (definition)");
        const tx = await contract.setTrait(
          tokenId, 
          definitionTraitKey, 
          definitionValue, 
          1 // 1 = string type
        );
        const receipt = await tx.wait();
        console.log("Definition updated successfully:", receipt);
      }

      // Update configuration trait if provided
      if (definitionUpdateForm.configuration.trim()) {
        const configTraitKey = ethers.keccak256(ethers.toUtf8Bytes("configuration"));
        const configValue = ethers.toUtf8Bytes(definitionUpdateForm.configuration);
        
        if (walletProvider && embeddedWalletInfo) {
          console.log("Using AppKit transaction for setTrait (configuration)");
          await executeAppKitTransaction(
            contractAddress,
            deedNFTAbi,
            'setTrait',
            [tokenId, configTraitKey, configValue, 1] // 1 = string type
          );
        } else {
          console.log("Using MetaMask transaction for setTrait (configuration)");
          const tx = await contract.setTrait(
            tokenId, 
            configTraitKey, 
            configValue, 
            1 // 1 = string type
          );
          await tx.wait();
        }
        console.log("Configuration updated successfully");
      }

      setSuccess("Definition updated successfully!");
      setDefinitionUpdateForm({ tokenId: "", definition: "", configuration: "" });
    } catch (error) {
      console.error("Error updating definition:", error);
      setValidationError(error instanceof Error ? error.message : "Failed to update definition");
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewDetails = (deedNFT: any) => {
    setSelectedDeedNFT(deedNFT);
    setIsViewerOpen(true);
  };

  if (!isWalletConnected) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Wallet Not Connected
            </h2>
            <p className="text-gray-600 dark:text-gray-300">
              Please connect your wallet to access the validation page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isCorrectNetwork && isWalletConnected) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Wrong Network
            </h2>
            <p className="text-gray-600 dark:text-gray-300">
              Please switch to a supported network to access the validation page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Validation Dashboard
            </h1>
            <p className="text-gray-600 dark:text-gray-300">
              Manage T-Deed validation, traits, and metadata
            </p>
          </div>
          <Button
            onClick={fetchDeedNFTs}
            disabled={loading}
            variant="outline"
            className="border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11 px-4"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Debug Information */}
      {isWalletConnected && isCorrectNetwork && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-blue-800 dark:text-blue-200 text-sm">
            <strong>Debug Info:</strong> Chain ID: {chainId}, Contract: {contractAddress}, 
            Total T-Deeds: {deedNFTs.length}, Filtered: {filteredDeedNFTs.length}
            {embeddedWalletInfo && (
              <span className="ml-2">
                | Embedded Wallet: {embeddedWalletInfo.authProvider} ({embeddedWalletInfo.accountType})
              </span>
            )}
          </p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/20">
                <Hash className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Total T-Deeds</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalDeedNFTs}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/20">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Validated</p>
                                 <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.validatedDeedNFTs}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/20">
                <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Pending</p>
                                 <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.pendingDeedNFTs}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/20">
                <User className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Your T-Deeds</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{userDeedNFTs.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm mb-8">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-3">
            {/* Search - Takes up 2/3 of the space */}
            <div className="flex-1 lg:flex-[2] space-y-2">
              <Label htmlFor="search" className="text-sm font-medium">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="search"
                  placeholder="Search by token ID or definition..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 border-black/10 dark:border-white/10 h-11"
                />
              </div>
            </div>

            {/* Status Filter - Flexible width */}
            <div className="flex-1 space-y-2">
              <Label htmlFor="status" className="text-sm font-medium">Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="border-black/10 dark:border-white/10 w-full">
                  <SelectValue placeholder="Filter by status" className="truncate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="validated">Validated</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Asset Type Filter - Flexible width */}
            <div className="flex-1 space-y-2">
              <Label htmlFor="assetType" className="text-sm font-medium">Asset Type</Label>
              <Select value={filterAssetType} onValueChange={setFilterAssetType}>
                <SelectTrigger className="border-black/10 dark:border-white/10 w-full">
                  <SelectValue placeholder="Filter by asset type" className="truncate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="land">Land</SelectItem>
                  <SelectItem value="vehicle">Vehicle</SelectItem>
                  <SelectItem value="estate">Estate</SelectItem>
                  <SelectItem value="commercialEquipment">Commercial Equipment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Clear Filters Button - Fixed width */}
            <div className="w-full lg:w-32 space-y-2">
              <Label className="text-sm font-medium opacity-0">Action</Label>
              <Button 
                onClick={() => {
                  setSearchTerm("");
                  setFilterStatus("all");
                  setFilterAssetType("all");
                }}
                variant="outline"
                className="w-full border-black/10 dark:border-white/10 h-11 px-4"
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <Tabs defaultValue="deednfts" className="w-full">
        <TabsList className="grid w-full grid-cols-4 bg-gray-100 dark:bg-gray-800">
          <TabsTrigger value="deednfts" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">
            T-Deeds ({filteredDeedNFTs.length})
          </TabsTrigger>
          <TabsTrigger value="traits" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">
            Add Traits
          </TabsTrigger>
          <TabsTrigger value="metadata" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">
            Metadata
          </TabsTrigger>
          <TabsTrigger value="validation" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">
            Validation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deednfts" className="space-y-6 mt-6">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
              <p className="text-gray-600 dark:text-gray-300 mt-4">Loading T-Deeds from blockchain...</p>
            </div>
          ) : filteredDeedNFTs.length === 0 ? (
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardContent className="p-8 text-center">
                <AlertCircle className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  No T-Deeds Found
                </h3>
                <p className="text-gray-600 dark:text-gray-300">
                  {deedNFTs.length === 0 ? "No T-Deeds found on this network" : "No T-Deeds match your current filters"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredDeedNFTs.map((deedNFT) => {
                const validationStatus = getValidationStatus(deedNFT);
                return (
                  <Card key={deedNFT.tokenId} className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg text-gray-900 dark:text-white">
                          #{deedNFT.tokenId}
                        </CardTitle>
                        <Badge 
                          variant="secondary" 
                          className={`${
                            validationStatus.color === "green" 
                              ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                              : "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300"
                          }`}
                        >
                          {validationStatus.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Asset Type</p>
                        <p className="text-gray-900 dark:text-white font-medium">
                          {getAssetTypeLabel(deedNFT.assetType)}
                        </p>
                      </div>
                      
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Definition</p>
                        <p className="text-gray-900 dark:text-white text-sm line-clamp-2">
                          {deedNFT.definition}
                        </p>
                      </div>

                      <div className="flex space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewDetails(deedNFT)}
                          className="flex-1 border-black/10 dark:border-white/10 h-11"
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleValidateDeed(deedNFT.tokenId)}
                          disabled={isLoading}
                          className="flex-1 border-black/10 dark:border-white/10 h-11"
                        >
                          <Shield className="w-4 h-4 mr-1" />
                          Validate
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              }                  )}
                </div>
              )}

              {/* Results Count */}
              {!loading && filteredDeedNFTs.length > 0 && (
                <div className="text-center mt-8">
                  <p className="text-gray-500 dark:text-gray-400">
                    Showing {filteredDeedNFTs.length} of {deedNFTs.length} T-Deeds
                  </p>
                </div>
              )}
            </TabsContent>

        <TabsContent value="traits" className="space-y-6 mt-6">
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-gray-900 dark:text-white">Add Trait to T-Deed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-3">
                  <Label htmlFor="tokenId" className="text-sm font-medium">Token ID</Label>
                  <Input
                    id="tokenId"
                    placeholder="Enter token ID (e.g., 1, 2, 3...)"
                    value={traitForm.tokenId}
                    onChange={(e) => setTraitForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>
                
                <div className="space-y-3">
                  <Label htmlFor="traitName" className="text-sm font-medium">Trait Name</Label>
                  <Input
                    id="traitName"
                    placeholder="e.g., color, size, year"
                    value={traitForm.traitName}
                    onChange={(e) => setTraitForm(prev => ({ ...prev, traitName: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-3">
                  <Label htmlFor="valueType" className="text-sm font-medium">Value Type</Label>
                  <Select 
                    value={traitForm.valueType} 
                    onValueChange={(value: "string" | "number" | "boolean") => 
                      setTraitForm(prev => ({ ...prev, valueType: value }))
                    }
                  >
                                    <SelectTrigger className="border-black/10 dark:border-white/10">
                  <SelectValue />
                </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="string">String</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="boolean">Boolean</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="traitValue" className="text-sm font-medium">Trait Value</Label>
                <Input
                  id="traitValue"
                  placeholder="Enter trait value"
                  value={traitForm.traitValue}
                  onChange={(e) => setTraitForm(prev => ({ ...prev, traitValue: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
              </div>

              <Button 
                onClick={() => handleAddTrait(traitForm.tokenId)}
                disabled={isLoading || !traitForm.tokenId || !traitForm.traitName || !traitForm.traitValue}
                className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white border border-white/10 h-11"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Trait
              </Button>
            </CardContent>
          </Card>

          {/* Remove Trait Card */}
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-gray-900 dark:text-white">Remove Trait from T-Deed</CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-300">
                Remove a trait from a T-Deed using the trait name
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label htmlFor="removeTokenId" className="text-sm font-medium">Token ID</Label>
                  <Input
                    id="removeTokenId"
                    placeholder="Enter token ID (e.g., 1, 2, 3...)"
                    value={removeTraitForm.tokenId}
                    onChange={(e) => setRemoveTraitForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>
                
                <div className="space-y-3">
                  <Label htmlFor="removeTraitName" className="text-sm font-medium">Trait Name</Label>
                  <Input
                    id="removeTraitName"
                    placeholder="e.g., color, size, year"
                    value={removeTraitForm.traitName}
                    onChange={(e) => setRemoveTraitForm(prev => ({ ...prev, traitName: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>
              </div>

              <Button 
                onClick={() => handleRemoveTrait(removeTraitForm.tokenId)}
                disabled={isLoading || !removeTraitForm.tokenId || !removeTraitForm.traitName}
                className="w-full bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 dark:text-white border border-red-600 h-11"
              >
                <XCircle className="w-4 h-4 mr-1" />
                Remove Trait
              </Button>
            </CardContent>
          </Card>

          {/* Update Trait Card */}
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-gray-900 dark:text-white">Update Trait Value</CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-300">
                Update the value of an existing trait on a T-Deed
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label htmlFor="updateTokenId" className="text-sm font-medium">Token ID</Label>
                  <Input
                    id="updateTokenId"
                    placeholder="Enter token ID (e.g., 1, 2, 3...)"
                    value={updateTraitForm.tokenId}
                    onChange={(e) => setUpdateTraitForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>
                
                <div className="space-y-3">
                  <Label htmlFor="updateTraitName" className="text-sm font-medium">Trait Name</Label>
                  <Input
                    id="updateTraitName"
                    placeholder="e.g., color, size, year"
                    value={updateTraitForm.traitName}
                    onChange={(e) => setUpdateTraitForm(prev => ({ ...prev, traitName: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label htmlFor="updateValueType" className="text-sm font-medium">Value Type</Label>
                  <Select 
                    value={updateTraitForm.valueType} 
                    onValueChange={(value: "string" | "number" | "boolean") => 
                      setUpdateTraitForm(prev => ({ ...prev, valueType: value }))
                    }
                  >
                    <SelectTrigger className="border-black/10 dark:border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="string">String</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="boolean">Boolean</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="updateTraitValue" className="text-sm font-medium">New Trait Value</Label>
                  <Input
                    id="updateTraitValue"
                    placeholder="Enter new trait value"
                    value={updateTraitForm.traitValue}
                    onChange={(e) => setUpdateTraitForm(prev => ({ ...prev, traitValue: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>
              </div>

              <Button 
                onClick={() => handleUpdateTrait(updateTraitForm.tokenId)}
                disabled={isLoading || !updateTraitForm.tokenId || !updateTraitForm.traitName || !updateTraitForm.traitValue}
                className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white border border-blue-600 h-11"
              >
                <Save className="w-4 h-4 mr-1" />
                Update Trait
              </Button>
            </CardContent>
          </Card>

          {/* Set Trait Name Card (Admin Only) */}
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-gray-900 dark:text-white">Set Trait Name (Admin Only)</CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-300">
                Set a human-readable name for a trait key. This is useful for traits whose keys are not derived from their string names.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label htmlFor="traitKey" className="text-sm font-medium">Trait Key</Label>
                  <Input
                    id="traitKey"
                    placeholder="e.g., color, size, year (will be hashed to bytes32)"
                    value={traitNameForm.traitKey}
                    onChange={(e) => setTraitNameForm(prev => ({ ...prev, traitKey: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>
                
                <div className="space-y-3">
                  <Label htmlFor="traitName" className="text-sm font-medium">Human-Readable Name</Label>
                  <Input
                    id="traitName"
                    placeholder="e.g., Color, Size, Year"
                    value={traitNameForm.traitName}
                    onChange={(e) => setTraitNameForm(prev => ({ ...prev, traitName: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Button 
                  onClick={handleSetTraitName}
                  disabled={isLoading || !traitNameForm.traitKey || !traitNameForm.traitName}
                  className="w-full bg-purple-600 hover:bg-purple-700 dark:bg-purple-600 dark:hover:bg-purple-700 dark:text-white border border-purple-600 h-11"
                >
                  <Hash className="w-4 h-4 mr-1" />
                  Set Trait Name
                </Button>
                
                <Button 
                  onClick={handleTestTraitName}
                  disabled={isLoading || !traitNameForm.traitKey}
                  variant="outline"
                  className="w-full border-purple-600 text-purple-600 hover:bg-purple-50 dark:border-purple-400 dark:text-purple-400 dark:hover:bg-purple-900/20 h-11"
                >
                  <Search className="w-4 h-4 mr-1" />
                  Test Lookup
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

                        <TabsContent value="metadata" className="space-y-6 mt-6">

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Custom Metadata */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 dark:text-white">Custom Metadata</CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-300">
                  Set custom metadata for a T-Deed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <Label htmlFor="metadataTokenId" className="text-sm font-medium">Token ID</Label>
                  <Input
                    id="metadataTokenId"
                    placeholder="Enter token ID"
                    value={customMetadataForm.tokenId}
                    onChange={(e) => setCustomMetadataForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-3">
                  <Label htmlFor="customMetadata" className="text-sm font-medium">Custom Metadata (JSON)</Label>
                  <Textarea
                    id="customMetadata"
                    placeholder="Enter custom metadata as JSON..."
                    value={customMetadataForm.customMetadata}
                    onChange={(e) => setCustomMetadataForm(prev => ({ ...prev, customMetadata: e.target.value }))}
                    className="border-black/10 dark:border-white/10 min-h-[120px]"
                    rows={4}
                  />
                </div>

                <Button 
                  onClick={handleSetCustomMetadata}
                  disabled={isLoading || !customMetadataForm.tokenId || !customMetadataForm.customMetadata}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white border border-white/10 h-11"
                >
                  <Save className="w-4 h-4 mr-1" />
                  Set Custom Metadata
                </Button>
              </CardContent>
            </Card>

            {/* Animation URL */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 dark:text-white">Animation URL</CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-300">
                  Set animation URL for a T-Deed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <Label htmlFor="animationTokenId" className="text-sm font-medium">Token ID</Label>
                  <Input
                    id="animationTokenId"
                    placeholder="Enter token ID"
                    value={animationURLForm.tokenId}
                    onChange={(e) => setAnimationURLForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-3">
                  <Label htmlFor="animationURL" className="text-sm font-medium">Animation URL</Label>
                  <Input
                    id="animationURL"
                    placeholder="https://example.com/animation.mp4"
                    value={animationURLForm.animationURL}
                    onChange={(e) => setAnimationURLForm(prev => ({ ...prev, animationURL: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <Button 
                  onClick={handleSetAnimationURL}
                  disabled={isLoading || !animationURLForm.tokenId || !animationURLForm.animationURL}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white border border-white/10 h-11"
                >
                  <Save className="w-4 h-4 mr-1" />
                  Set Animation URL
                </Button>
              </CardContent>
            </Card>

            {/* External Link */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 dark:text-white">External Link</CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-300">
                  Set external link for a T-Deed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <Label htmlFor="externalTokenId" className="text-sm font-medium">Token ID</Label>
                  <Input
                    id="externalTokenId"
                    placeholder="Enter token ID"
                    value={externalLinkForm.tokenId}
                    onChange={(e) => setExternalLinkForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-3">
                  <Label htmlFor="externalLink" className="text-sm font-medium">External Link</Label>
                  <Input
                    id="externalLink"
                    placeholder="https://example.com"
                    value={externalLinkForm.externalLink}
                    onChange={(e) => setExternalLinkForm(prev => ({ ...prev, externalLink: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <Button 
                  onClick={handleSetExternalLink}
                  disabled={isLoading || !externalLinkForm.tokenId || !externalLinkForm.externalLink}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white border border-white/10 h-11"
                >
                  <Save className="w-4 h-4 mr-1" />
                  Set External Link
                </Button>
              </CardContent>
            </Card>

            {/* Document Management */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 dark:text-white">Document Management</CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-300">
                  Add or remove documents for a T-Deed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="documentTokenId" className="text-sm font-medium">Token ID</Label>
                  <Input
                    id="documentTokenId"
                    placeholder="Enter token ID"
                    value={documentForm.tokenId}
                    onChange={(e) => setDocumentForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="docType" className="text-sm font-medium">Document Type</Label>
                  <Input
                    id="docType"
                    placeholder="e.g., deed, title, inspection"
                    value={documentForm.docType}
                    onChange={(e) => setDocumentForm(prev => ({ ...prev, docType: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="documentURI" className="text-sm font-medium">Document URI</Label>
                  <Input
                    id="documentURI"
                    placeholder="https://example.com/document.pdf"
                    value={documentForm.documentURI}
                    onChange={(e) => setDocumentForm(prev => ({ ...prev, documentURI: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isRemove"
                    checked={documentForm.isRemove}
                    onChange={(e) => setDocumentForm(prev => ({ ...prev, isRemove: e.target.checked }))}
                    className="rounded border-black/10 dark:border-white/10"
                  />
                  <Label htmlFor="isRemove" className="text-sm font-medium">Remove Document</Label>
                </div>

                <Button 
                  onClick={handleManageDocument}
                  disabled={isLoading || !documentForm.tokenId || !documentForm.docType}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white border border-white/10 h-11"
                >
                  <Save className="w-4 h-4 mr-1" />
                  {documentForm.isRemove ? "Remove Document" : "Add Document"}
                </Button>
              </CardContent>
            </Card>

            {/* Asset Condition */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 dark:text-white">Asset Condition</CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-300">
                  Set asset condition information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="conditionTokenId" className="text-sm font-medium">Token ID</Label>
                  <Input
                    id="conditionTokenId"
                    placeholder="Enter token ID"
                    value={assetConditionForm.tokenId}
                    onChange={(e) => setAssetConditionForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="generalCondition" className="text-sm font-medium">General Condition</Label>
                  <Select 
                    value={assetConditionForm.generalCondition} 
                    onValueChange={(value) => setAssetConditionForm(prev => ({ ...prev, generalCondition: value }))}
                  >
                    <SelectTrigger className="border-black/10 dark:border-white/10 h-11">
                      <SelectValue placeholder="Select condition" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Excellent">Excellent</SelectItem>
                      <SelectItem value="Good">Good</SelectItem>
                      <SelectItem value="Fair">Fair</SelectItem>
                      <SelectItem value="Poor">Poor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastInspectionDate" className="text-sm font-medium">Last Inspection Date</Label>
                  <Input
                    id="lastInspectionDate"
                    type="date"
                    value={assetConditionForm.lastInspectionDate}
                    onChange={(e) => setAssetConditionForm(prev => ({ ...prev, lastInspectionDate: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="additionalNotes" className="text-sm font-medium">Additional Notes</Label>
                  <Textarea
                    id="additionalNotes"
                    placeholder="Additional notes about the asset condition..."
                    value={assetConditionForm.additionalNotes}
                    onChange={(e) => setAssetConditionForm(prev => ({ ...prev, additionalNotes: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                    rows={3}
                  />
                </div>

                <Button 
                  onClick={handleSetAssetCondition}
                  disabled={isLoading || !assetConditionForm.tokenId || !assetConditionForm.generalCondition}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white border border-white/10 h-11"
                >
                  <Save className="w-4 h-4 mr-1" />
                  Set Asset Condition
                </Button>
              </CardContent>
            </Card>

            {/* Legal Information */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 dark:text-white">Legal Information</CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-300">
                  Set legal information for a DeedNFT
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="legalTokenId" className="text-sm font-medium">Token ID</Label>
                  <Input
                    id="legalTokenId"
                    placeholder="Enter token ID"
                    value={legalInfoForm.tokenId}
                    onChange={(e) => setLegalInfoForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jurisdiction" className="text-sm font-medium">Jurisdiction</Label>
                  <Input
                    id="jurisdiction"
                    placeholder="e.g., California, USA"
                    value={legalInfoForm.jurisdiction}
                    onChange={(e) => setLegalInfoForm(prev => ({ ...prev, jurisdiction: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="registrationNumber" className="text-sm font-medium">Registration Number</Label>
                  <Input
                    id="registrationNumber"
                    placeholder="Official registration number"
                    value={legalInfoForm.registrationNumber}
                    onChange={(e) => setLegalInfoForm(prev => ({ ...prev, registrationNumber: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="registrationDate" className="text-sm font-medium">Registration Date</Label>
                  <Input
                    id="registrationDate"
                    type="date"
                    value={legalInfoForm.registrationDate}
                    onChange={(e) => setLegalInfoForm(prev => ({ ...prev, registrationDate: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="additionalInfo" className="text-sm font-medium">Additional Legal Info</Label>
                  <Textarea
                    id="additionalInfo"
                    placeholder="Additional legal information..."
                    value={legalInfoForm.additionalInfo}
                    onChange={(e) => setLegalInfoForm(prev => ({ ...prev, additionalInfo: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                    rows={3}
                  />
                </div>

                <Button 
                  onClick={handleSetLegalInfo}
                  disabled={isLoading || !legalInfoForm.tokenId || !legalInfoForm.jurisdiction}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white border border-white/10 h-11"
                >
                  <Save className="w-4 h-4 mr-1" />
                  Set Legal Info
                </Button>
              </CardContent>
            </Card>

            {/* Features */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 dark:text-white">Features</CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-300">
                  Set features for a T-Deed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="featuresTokenId" className="text-sm font-medium">Token ID</Label>
                  <Input
                    id="featuresTokenId"
                    placeholder="Enter token ID"
                    value={featuresForm.tokenId}
                    onChange={(e) => setFeaturesForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="features" className="text-sm font-medium">Features (comma-separated)</Label>
                  <Textarea
                    id="features"
                    placeholder="e.g., pool, garage, garden, security system"
                    value={featuresForm.features.join(", ")}
                    onChange={(e) => setFeaturesForm(prev => ({ 
                      ...prev, 
                      features: e.target.value.split(",").map(f => f.trim()).filter(f => f.length > 0)
                    }))}
                    className="border-black/10 dark:border-white/10"
                    rows={3}
                  />
                </div>

                <Button 
                  onClick={handleSetFeatures}
                  disabled={isLoading || !featuresForm.tokenId || featuresForm.features.length === 0}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white border border-white/10 h-11"
                >
                  <Save className="w-4 h-4 mr-1" />
                  Set Features
                </Button>
              </CardContent>
            </Card>

            {/* Gallery */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 dark:text-white">Gallery</CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-300">
                  Set gallery images for a T-Deed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="galleryTokenId" className="text-sm font-medium">Token ID</Label>
                  <Input
                    id="galleryTokenId"
                    placeholder="Enter token ID"
                    value={galleryForm.tokenId}
                    onChange={(e) => setGalleryForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="imageUrls" className="text-sm font-medium">Image URLs (one per line)</Label>
                  <Textarea
                    id="imageUrls"
                    placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg&#10;https://example.com/image3.jpg"
                    value={galleryForm.imageUrls.join("\n")}
                    onChange={(e) => setGalleryForm(prev => ({ 
                      ...prev, 
                      imageUrls: e.target.value.split("\n").map(url => url.trim()).filter(url => url.length > 0)
                    }))}
                    className="border-black/10 dark:border-white/10"
                    rows={4}
                  />
                </div>

                <Button 
                  onClick={handleSetGallery}
                  disabled={isLoading || !galleryForm.tokenId || galleryForm.imageUrls.length === 0}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white border border-white/10 h-11"
                >
                  <Save className="w-4 h-4 mr-1" />
                  Set Gallery
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Definition Update */}
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-gray-900 dark:text-white">Update Definition</CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-300">
                Update the definition and configuration of a T-Deed
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label htmlFor="definitionTokenId" className="text-sm font-medium">Token ID</Label>
                <Input
                  id="definitionTokenId"
                  placeholder="Enter token ID"
                  value={definitionUpdateForm.tokenId}
                  onChange={(e) => setDefinitionUpdateForm(prev => ({ ...prev, tokenId: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
              </div>

              <div className="space-y-3">
                <Label htmlFor="definition" className="text-sm font-medium">Definition *</Label>
                <Textarea
                  id="definition"
                  placeholder="Describe the asset in detail..."
                  value={definitionUpdateForm.definition}
                  onChange={(e) => setDefinitionUpdateForm(prev => ({ ...prev, definition: e.target.value }))}
                  className="border-black/10 dark:border-white/10 min-h-[120px]"
                  rows={4}
                  required
                />
                <p className="text-sm text-gray-500 dark:text-gray-400">Required field for updating definition</p>
              </div>

              <div className="space-y-3">
                <Label htmlFor="configuration" className="text-sm font-medium">Configuration (Optional)</Label>
                <Textarea
                  id="configuration"
                  placeholder="Additional configuration details..."
                  value={definitionUpdateForm.configuration}
                  onChange={(e) => setDefinitionUpdateForm(prev => ({ ...prev, configuration: e.target.value }))}
                  className="border-black/10 dark:border-white/10 min-h-[100px]"
                  rows={3}
                />
              </div>

              <Button 
                onClick={handleUpdateDefinition}
                disabled={isLoading || !definitionUpdateForm.tokenId || !definitionUpdateForm.definition.trim()}
                className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white border border-white/10 h-11"
              >
                <Save className="w-4 h-4 mr-1" />
                Update Definition
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="validation" className="space-y-6 mt-6">
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-gray-900 dark:text-white">Update Validation Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <Label htmlFor="validationTokenId">Token ID</Label>
                  <Input
                    id="validationTokenId"
                    placeholder="Enter token ID"
                    value={validationForm.tokenId}
                    onChange={(e) => setValidationForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>

                <div className="space-y-3">
                  <Label htmlFor="validationStatus">Validation Status</Label>
                  <Select 
                    value={validationForm.isValid.toString()} 
                    onValueChange={(value) => 
                      setValidationForm(prev => ({ ...prev, isValid: value === "true" }))
                    }
                  >
                    <SelectTrigger className="border-black/10 dark:border-white/10 h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Valid</SelectItem>
                      <SelectItem value="false">Invalid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="validationNotes">Notes</Label>
                <Textarea
                  id="validationNotes"
                  placeholder="Add validation notes..."
                  value={validationForm.notes}
                  onChange={(e) => setValidationForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="border-black/10 dark:border-white/10"
                  rows={3}
                />
              </div>

              <Button 
                onClick={() => handleUpdateValidation(validationForm.tokenId)}
                disabled={isLoading || !validationForm.tokenId}
                className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white border border-white/10 h-11"
              >
                <Save className="w-4 h-4 mr-1" />
                Update Validation
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Error/Success Messages */}
      {validationError && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 mt-6">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              <p className="text-red-700 dark:text-red-300">{validationError}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success Messages */}
      {success && (
        <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 mt-6">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              <p className="text-green-700 dark:text-green-300">{success}</p>
              {isRefreshing && (
                <div className="flex items-center space-x-2 ml-4">
                  <RefreshCw className="w-4 h-4 text-green-600 dark:text-green-400 animate-spin" />
                  <span className="text-green-700 dark:text-green-300 text-sm">Refreshing data...</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}



      {/* DeedNFT Viewer Modal */}
      {selectedDeedNFT && (
        <DeedNFTViewer 
          key={`${selectedDeedNFT.tokenId}-${refreshKey}`} // Add key to force re-render
          deedNFT={selectedDeedNFT} 
          isOpen={isViewerOpen}
          onClose={() => {
            setIsViewerOpen(false);
            setSelectedDeedNFT(null);
          }}
          getAssetTypeLabel={getAssetTypeLabel}
          getValidationStatus={getValidationStatus}
        />
      )}
    </div>
  );
};

export default Validation; 