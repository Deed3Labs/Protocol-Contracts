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
import { useAccount, useChainId } from "wagmi";
import { ethers } from "ethers";
import { useDeedNFTData } from "@/hooks/useDeedNFTData";
import { getContractAddressForNetwork, getAbiPathForNetwork } from "@/config/networks";
import DeedNFTViewer from "./DeedNFTViewer";

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

const Validation: React.FC<ValidationPageProps> = () => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
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
    currentChainId,
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

  // Form states
  const [traitForm, setTraitForm] = useState<TraitFormData>({
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

  // Contract interaction
  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [validatorContract, setValidatorContract] = useState<ethers.Contract | null>(null);
  const [metadataRendererContract, setMetadataRendererContract] = useState<ethers.Contract | null>(null);

  // Initialize contracts
  useEffect(() => {
    if (chainId && isConnected) {
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
  }, [chainId, isConnected]);

  const initializeContracts = async (contractAddress: string) => {
    try {
      console.log("Initializing contracts for address:", contractAddress);
      const provider = new ethers.BrowserProvider(window.ethereum as any);
      const signer = await provider.getSigner();
      
      // Initialize DeedNFT contract
      console.log("Loading DeedNFT ABI for chainId:", chainId);
      const deedNFTAbi = await getDeedNFTAbi(chainId);
      const deedNFTContract = new ethers.Contract(contractAddress, deedNFTAbi, signer);
      setContract(deedNFTContract);
      console.log("DeedNFT contract initialized");

      // Get validator address from the contract
      console.log("Getting validator address from DeedNFT contract");
      const validatorAddress = await deedNFTContract.getTransferValidator();
      console.log("Validator address:", validatorAddress);
      
      if (validatorAddress && validatorAddress !== ethers.ZeroAddress) {
        // Initialize Validator contract
        console.log("Loading Validator ABI for chainId:", chainId);
        const validatorAbi = await getValidatorAbi(chainId);
        const validatorContract = new ethers.Contract(validatorAddress, validatorAbi, signer);
        setValidatorContract(validatorContract);
        console.log("Validator contract initialized");
      } else {
        console.warn("No validator address found or address is zero");
      }

      // Get MetadataRenderer address from the contract
      console.log("Getting MetadataRenderer address from DeedNFT contract");
      const metadataRendererAddress = await deedNFTContract.metadataRenderer();
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

  // Check if user has validator permissions
  const checkValidatorPermissions = async () => {
    if (!validatorContract || !address) return false;
    
    try {
      const VALIDATOR_ROLE = await validatorContract.VALIDATOR_ROLE();
      const hasRole = await validatorContract.hasRole(VALIDATOR_ROLE, address);
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

    try {
      const hasPermission = await checkValidatorPermissions();
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

      const tx = await contract.setTrait(
        parseInt(tokenId),
        ethers.toUtf8Bytes(traitForm.traitName),
        encodedValue,
        traitForm.valueType === "string" ? 1 : traitForm.valueType === "number" ? 2 : 3
      );

      await tx.wait();
      setSuccess("Trait added successfully");
      setTraitForm({ tokenId: "", traitName: "", traitValue: "", valueType: "string" });
      
      // Refresh data
      window.location.reload();
    } catch (error) {
      console.error("Error adding trait:", error);
      setValidationError("Failed to add trait");
    } finally {
      setIsLoading(false);
    }
  };

  // Update validation status
  const handleUpdateValidation = async (tokenId: string) => {
    if (!validatorContract) {
      setValidationError("Validator contract not initialized");
      return;
    }

    setIsLoading(true);
    setValidationError(null);

    try {
      const hasPermission = await checkValidatorPermissions();
      if (!hasPermission) {
        setValidationError("You don't have permission to update validation status");
        return;
      }

      const tx = await validatorContract.updateValidationStatus(
        parseInt(tokenId),
        validationForm.isValid,
        address
      );

      await tx.wait();
      setSuccess("Validation status updated successfully");
      setValidationForm({ tokenId: "", isValid: false, notes: "" });
      
      // Refresh data
      window.location.reload();
    } catch (error) {
      console.error("Error updating validation:", error);
      setValidationError("Failed to update validation status");
    } finally {
      setIsLoading(false);
    }
  };

  // Validate deed using validator contract
  const handleValidateDeed = async (tokenId: string) => {
    if (!validatorContract) {
      setValidationError("Validator contract not initialized");
      return;
    }

    setIsLoading(true);
    setValidationError(null);

    try {
      const hasPermission = await checkValidatorPermissions();
      if (!hasPermission) {
        setValidationError("You don't have permission to validate deeds");
        return;
      }

      const tx = await validatorContract.validateDeed(parseInt(tokenId));
      await tx.wait();
      setSuccess("Deed validated successfully");
      
      // Refresh data
      window.location.reload();
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

    try {
      const hasPermission = await checkValidatorPermissions();
      if (!hasPermission) {
        setValidationError("You don't have permission to update metadata");
        return;
      }

      // Call the specific function: setTokenCustomMetadata(uint256 tokenId, string metadata)
      const tx = await metadataRendererContract.setTokenCustomMetadata(
        parseInt(customMetadataForm.tokenId),
        customMetadataForm.customMetadata
      );

      await tx.wait();
      setSuccess("Custom metadata updated successfully");
      setCustomMetadataForm({ tokenId: "", customMetadata: "" });
      
      // Refresh data
      window.location.reload();
    } catch (error) {
      console.error("Error updating custom metadata:", error);
      setValidationError("Failed to update custom metadata");
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

    try {
      const hasPermission = await checkValidatorPermissions();
      if (!hasPermission) {
        setValidationError("You don't have permission to update metadata");
        return;
      }

      // Call the specific function: setTokenAnimationURL(uint256 tokenId, string animationURL)
      const tx = await metadataRendererContract.setTokenAnimationURL(
        parseInt(animationURLForm.tokenId),
        animationURLForm.animationURL
      );

      await tx.wait();
      setSuccess("Animation URL updated successfully");
      setAnimationURLForm({ tokenId: "", animationURL: "" });
      
      // Refresh data
      window.location.reload();
    } catch (error) {
      console.error("Error updating animation URL:", error);
      setValidationError("Failed to update animation URL");
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

    try {
      const hasPermission = await checkValidatorPermissions();
      if (!hasPermission) {
        setValidationError("You don't have permission to update metadata");
        return;
      }

      // Call the specific function: setTokenExternalLink(uint256 tokenId, string externalLink)
      const tx = await metadataRendererContract.setTokenExternalLink(
        parseInt(externalLinkForm.tokenId),
        externalLinkForm.externalLink
      );

      await tx.wait();
      setSuccess("External link updated successfully");
      setExternalLinkForm({ tokenId: "", externalLink: "" });
      
      // Refresh data
      window.location.reload();
    } catch (error) {
      console.error("Error updating external link:", error);
      setValidationError("Failed to update external link");
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

    try {
      const hasPermission = await checkValidatorPermissions();
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
      
      // Refresh data
      window.location.reload();
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

    try {
      const hasPermission = await checkValidatorPermissions();
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
      
      // Refresh data
      window.location.reload();
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

    try {
      const hasPermission = await checkValidatorPermissions();
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
      
      // Refresh data
      window.location.reload();
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

    try {
      const hasPermission = await checkValidatorPermissions();
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
      
      // Refresh data
      window.location.reload();
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

    try {
      const hasPermission = await checkValidatorPermissions();
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
      
      // Refresh data
      window.location.reload();
    } catch (error) {
      console.error("Error updating gallery:", error);
      setValidationError("Failed to update gallery");
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewDetails = (deedNFT: any) => {
    setSelectedDeedNFT(deedNFT);
    setIsViewerOpen(true);
  };

  if (!isConnected) {
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

  if (!isCorrectNetwork && isConnected) {
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
      {isConnected && isCorrectNetwork && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-blue-800 dark:text-blue-200 text-sm">
            <strong>Debug Info:</strong> Chain ID: {currentChainId}, Contract: {contractAddress}, 
            Total T-Deeds: {deedNFTs.length}, Filtered: {filteredDeedNFTs.length}
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
        </TabsContent>

                        <TabsContent value="metadata" className="space-y-6 mt-6">

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Custom Metadata */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 dark:text-white">Custom Metadata</CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-300">
                  Set custom metadata for a DeedNFT
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
                  Set animation URL for a DeedNFT
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
                  Set external link for a DeedNFT
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
                  Add or remove documents for a DeedNFT
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="documentTokenId">Token ID</Label>
                  <Input
                    id="documentTokenId"
                    placeholder="Enter token ID"
                    value={documentForm.tokenId}
                    onChange={(e) => setDocumentForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                  />
                </div>

                <div>
                  <Label htmlFor="docType">Document Type</Label>
                  <Input
                    id="docType"
                    placeholder="e.g., deed, title, inspection"
                    value={documentForm.docType}
                    onChange={(e) => setDocumentForm(prev => ({ ...prev, docType: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                  />
                </div>

                <div>
                  <Label htmlFor="documentURI">Document URI</Label>
                  <Input
                    id="documentURI"
                    placeholder="https://example.com/document.pdf"
                    value={documentForm.documentURI}
                    onChange={(e) => setDocumentForm(prev => ({ ...prev, documentURI: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
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
                  <Label htmlFor="isRemove">Remove Document</Label>
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
                <div>
                  <Label htmlFor="conditionTokenId">Token ID</Label>
                  <Input
                    id="conditionTokenId"
                    placeholder="Enter token ID"
                    value={assetConditionForm.tokenId}
                    onChange={(e) => setAssetConditionForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                  />
                </div>

                <div>
                  <Label htmlFor="generalCondition">General Condition</Label>
                  <Select 
                    value={assetConditionForm.generalCondition} 
                    onValueChange={(value) => setAssetConditionForm(prev => ({ ...prev, generalCondition: value }))}
                  >
                    <SelectTrigger className="border-black/10 dark:border-white/10">
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

                <div>
                  <Label htmlFor="lastInspectionDate">Last Inspection Date</Label>
                  <Input
                    id="lastInspectionDate"
                    type="date"
                    value={assetConditionForm.lastInspectionDate}
                    onChange={(e) => setAssetConditionForm(prev => ({ ...prev, lastInspectionDate: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                  />
                </div>

                <div>
                  <Label htmlFor="additionalNotes">Additional Notes</Label>
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
                <div>
                  <Label htmlFor="legalTokenId">Token ID</Label>
                  <Input
                    id="legalTokenId"
                    placeholder="Enter token ID"
                    value={legalInfoForm.tokenId}
                    onChange={(e) => setLegalInfoForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                  />
                </div>

                <div>
                  <Label htmlFor="jurisdiction">Jurisdiction</Label>
                  <Input
                    id="jurisdiction"
                    placeholder="e.g., California, USA"
                    value={legalInfoForm.jurisdiction}
                    onChange={(e) => setLegalInfoForm(prev => ({ ...prev, jurisdiction: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                  />
                </div>

                <div>
                  <Label htmlFor="registrationNumber">Registration Number</Label>
                  <Input
                    id="registrationNumber"
                    placeholder="Official registration number"
                    value={legalInfoForm.registrationNumber}
                    onChange={(e) => setLegalInfoForm(prev => ({ ...prev, registrationNumber: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                  />
                </div>

                <div>
                  <Label htmlFor="registrationDate">Registration Date</Label>
                  <Input
                    id="registrationDate"
                    type="date"
                    value={legalInfoForm.registrationDate}
                    onChange={(e) => setLegalInfoForm(prev => ({ ...prev, registrationDate: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                  />
                </div>

                <div>
                  <Label htmlFor="additionalInfo">Additional Legal Info</Label>
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
                  Set features for a DeedNFT
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="featuresTokenId">Token ID</Label>
                  <Input
                    id="featuresTokenId"
                    placeholder="Enter token ID"
                    value={featuresForm.tokenId}
                    onChange={(e) => setFeaturesForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                  />
                </div>

                <div>
                  <Label htmlFor="features">Features (comma-separated)</Label>
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
                  Set gallery images for a DeedNFT
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="galleryTokenId">Token ID</Label>
                  <Input
                    id="galleryTokenId"
                    placeholder="Enter token ID"
                    value={galleryForm.tokenId}
                    onChange={(e) => setGalleryForm(prev => ({ ...prev, tokenId: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                  />
                </div>

                <div>
                  <Label htmlFor="imageUrls">Image URLs (one per line)</Label>
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

      {success && (
        <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 mt-6">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              <p className="text-green-700 dark:text-green-300">{success}</p>
            </div>
          </CardContent>
        </Card>
      )}



      {/* DeedNFT Viewer Modal */}
      {selectedDeedNFT && (
        <DeedNFTViewer 
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