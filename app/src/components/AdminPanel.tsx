import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppKitAccount, useAppKitNetwork, useAppKitProvider } from '@reown/appkit/react';
import type { Eip1193Provider } from 'ethers';
import { NetworkWarning } from "@/components/NetworkWarning";
import { useNetworkValidation } from "@/hooks/useNetworkValidation";
import { getContractAddressForNetwork, getAbiPathForNetwork } from "@/config/networks";
import { EIP5792Utils } from "@/utils/EIP5792Utils";
import { 
  Shield, 
  Users, 
  DollarSign, 
  FileText, 
  AlertTriangle, 
  UserPlus,
  UserMinus,
  Database,
  Lock,
  Unlock
} from "lucide-react";

// Dynamic ABI loading functions
const getDeedNFTAbi = async (chainId: number) => {
  try {
    const abiPath = getAbiPathForNetwork(chainId, 'DeedNFT');
    const abiModule = await import(abiPath);
    return JSON.parse(abiModule.default.abi);
  } catch (error) {
    console.error('Error loading DeedNFT ABI:', error);
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
    const fallbackModule = await import('@/contracts/base-sepolia/Validator.json');
    return JSON.parse(fallbackModule.default.abi);
  }
};

const getFundManagerAbi = async (chainId: number) => {
  try {
    const abiPath = getAbiPathForNetwork(chainId, 'FundManager');
    const abiModule = await import(abiPath);
    return JSON.parse(abiModule.default.abi);
  } catch (error) {
    console.error('Error loading FundManager ABI:', error);
    const fallbackModule = await import('@/contracts/base-sepolia/FundManager.json');
    return JSON.parse(fallbackModule.default.abi);
  }
};

const getValidatorRegistryAbi = async (chainId: number) => {
  try {
    const abiPath = getAbiPathForNetwork(chainId, 'ValidatorRegistry');
    const abiModule = await import(abiPath);
    return JSON.parse(abiModule.default.abi);
  } catch (error) {
    console.error('Error loading ValidatorRegistry ABI:', error);
    const fallbackModule = await import('@/contracts/base-sepolia/ValidatorRegistry.json');
    return JSON.parse(fallbackModule.default.abi);
  }
};

// Role definitions
const ROLES = {
  DEFAULT_ADMIN_ROLE: "0x0000000000000000000000000000000000000000000000000000000000000000",
  VALIDATOR_ROLE: "0x2172861495e7b85edac73e3cd5fbb42dd675baadf627720e687bcfdaca025096",
  MINTER_ROLE: "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
  METADATA_ROLE: "0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9f6df31a2a355e4bd87e",
  CRITERIA_MANAGER_ROLE: "0x8f4fcdda5e994d0bb1a6cfa8577caa70b3eab9bef0a2c4d4b9b8b0d5b0f8c8c8",
  FEE_MANAGER_ROLE: "0x8f4fcdda5e994d0bb1a6cfa8577caa70b3eab9bef0a2c4d4b9b8b0d5b0f8c8c9",
  ADMIN_ROLE: "0x8f4fcdda5e994d0bb1a6cfa8577caa70b3eab9bef0a2c4d4b9b8b0d5b0f8c8ca",
  REGISTRY_ADMIN_ROLE: "0x8f4fcdda5e994d0bb1a6cfa8577caa70b3eab9bef0a2c4d4b9b8b0d5b0f8c8cb"
};

// contractRoles mapping
const contractRoles = {
  deedNFT: [
    { value: ROLES.DEFAULT_ADMIN_ROLE, label: 'Default Admin' },
    { value: ROLES.VALIDATOR_ROLE, label: 'Validator' },
    { value: ROLES.MINTER_ROLE, label: 'Minter' },
    { value: ROLES.ADMIN_ROLE, label: 'Administrator' },
  ],
  validator: [
    { value: ROLES.VALIDATOR_ROLE, label: 'Validator' },
    { value: ROLES.METADATA_ROLE, label: 'Metadata Manager' },
    { value: ROLES.CRITERIA_MANAGER_ROLE, label: 'Criteria Manager' },
    { value: ROLES.FEE_MANAGER_ROLE, label: 'Fee Manager' },
    { value: ROLES.ADMIN_ROLE, label: 'Administrator' },
  ],
  fundManager: [
    { value: ROLES.ADMIN_ROLE, label: 'Administrator' },
    { value: ROLES.FEE_MANAGER_ROLE, label: 'Fee Manager' },
    { value: ROLES.MINTER_ROLE, label: 'Minter' },
  ],
  validatorRegistry: [
    { value: ROLES.REGISTRY_ADMIN_ROLE, label: 'Registry Admin' },
  ],
};

const AdminPanel = () => {
  const {
    address,
    isConnected,
    embeddedWalletInfo
  } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider("eip155");
  const { isCorrectNetwork } = useNetworkValidation();
  
  // Derive chainId from caipNetworkId
  const chainId = caipNetworkId ? parseInt(caipNetworkId.split(':')[1]) : undefined;
  
  // Create a combined connection state that recognizes both traditional and embedded wallets
  // For embedded wallets, we recognize them even when not deployed (lazy deployment)
  const isWalletConnected = isConnected || (embeddedWalletInfo !== null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [contracts, setContracts] = useState<any>({});
  const [activeTab, setActiveTab] = useState("deednft");
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);

  // Form states
  interface RoleFormState {
    targetAddress: string;
    selectedContract: string;
    role: string;
    action: string;
  }

  const [roleForm, setRoleForm] = useState<RoleFormState>({
    targetAddress: "",
    selectedContract: "deedNFT",
    role: ROLES.VALIDATOR_ROLE,
    action: "grant" // "grant" or "revoke"
  });

  const [deedNFTForm, setDeedNFTForm] = useState({
    contractURI: "",
    traitKey: "",
    traitName: "",
    marketplace: "",
    marketplaceApproved: false,
    enforceRoyalties: false,
    transferValidator: "",
    fundManager: ""
  });

  const [validatorForm, setValidatorForm] = useState({
    serviceFee: "",
    tokenAddress: "",
    operatingAgreementUri: "",
    agreementName: "",
    royaltyPercentage: "",
    royaltyReceiver: ""
  });

  const [fundManagerForm, setFundManagerForm] = useState({
    commissionPercentage: "",
    feeReceiver: "",
    validatorRegistry: "",
    deedNFTAddress: "",
    tokenAddress: ""
  });

  const [validatorRegistryForm, setValidatorRegistryForm] = useState({
    validatorAddress: "",
    validatorName: "",
    validatorDescription: "",
    supportedAssetTypes: ""
  });

  // Load contracts and user roles
  useEffect(() => {
    if (isWalletConnected && chainId && isCorrectNetwork) {
      loadContracts();
    }
  }, [isWalletConnected, chainId, isCorrectNetwork]);

  // Load user roles after contracts are loaded
  useEffect(() => {
    if (contracts.deedNFT && address) {
      loadUserRoles();
    }
  }, [contracts.deedNFT, address]);

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

  const loadContracts = async () => {
    if (!isWalletConnected || !chainId) return;

    try {
      // Use AppKit provider for embedded wallets, otherwise fallback to MetaMask
      let signer;
      
      if (walletProvider && embeddedWalletInfo) {
        console.log("Using AppKit provider for embedded wallet");
        signer = walletProvider as any;
      } else {
        console.log("Using MetaMask provider");
        if (!window.ethereum) {
          throw new Error("No wallet detected. Please install MetaMask or another wallet.");
        }
        const provider = new ethers.BrowserProvider(window.ethereum as unknown as Eip1193Provider);
        signer = await provider.getSigner();
      }

      // Load DeedNFT contract
      const deedNFTAddress = getContractAddressForNetwork(chainId);
      if (deedNFTAddress) {
        const deedNFTAbi = await getDeedNFTAbi(chainId);
        const deedNFTContract = new ethers.Contract(deedNFTAddress, deedNFTAbi, signer);
        setContracts((prev: Record<string, any>) => ({ ...prev, deedNFT: deedNFTContract }));

        // Try to get FundManager address
        try {
          const fundManagerAddress = await deedNFTContract.fundManager();
          if (fundManagerAddress !== ethers.ZeroAddress) {
            const fundManagerAbi = await getFundManagerAbi(chainId);
            const fundManagerContract = new ethers.Contract(fundManagerAddress, fundManagerAbi, signer);
            setContracts((prev: Record<string, any>) => ({ ...prev, fundManager: fundManagerContract }));
          }
        } catch (error) {
          console.log("No FundManager set on DeedNFT");
        }
      }

      // Load ValidatorRegistry (you might need to get this address from deployment)
      // For now, we'll try to get it from the network config
      const validatorRegistryAddress = "0x979E6cC741A8481f96739A996D06EcFb9BA2bc91"; // Base Sepolia
      if (validatorRegistryAddress) {
        const validatorRegistryAbi = await getValidatorRegistryAbi(chainId);
        const validatorRegistryContract = new ethers.Contract(validatorRegistryAddress, validatorRegistryAbi, signer);
        setContracts((prev: Record<string, any>) => ({ ...prev, validatorRegistry: validatorRegistryContract }));
      }

    } catch (error) {
      console.error('Error loading contracts:', error);
      setError('Failed to load contracts');
    }
  };

  const loadUserRoles = async () => {
    if (!address) return;

    setIsLoadingRoles(true);
    try {
      console.log('Loading user roles for address:', address);
      const userRolesList: string[] = [];
      
      if (!chainId) {
        throw new Error("Chain ID not available");
      }
      
      const contractAddress = getContractAddressForNetwork(chainId);
      if (!contractAddress) {
        throw new Error("No contract address found for current network");
      }
      
      const abi = await getDeedNFTAbi(chainId);
      
      // Check each role
      for (const [roleKey, roleValue] of Object.entries(ROLES)) {
        try {
          let hasRole: boolean;
          
          if (walletProvider && embeddedWalletInfo) {
            console.log(`Using AppKit call for hasRole: ${roleKey}`);
            const result = await executeAppKitCall(
              contractAddress,
              abi,
              'hasRole',
              [roleValue, address]
            );
            // Decode the result (hasRole returns a boolean)
            hasRole = new ethers.Interface(abi).decodeFunctionResult('hasRole', result)[0];
          } else {
            // Use traditional ethers.js for MetaMask
            hasRole = await contracts.deedNFT.hasRole(roleValue, address);
          }
          
          console.log(`Role ${roleKey}: ${hasRole}`);
          if (hasRole) {
            userRolesList.push(roleKey);
          }
        } catch (error) {
          console.log(`Error checking role ${roleKey}:`, error);
        }
      }

      // Also check if user is the owner (for contracts that use Ownable)
      try {
        let owner: string;
        
        if (walletProvider && embeddedWalletInfo) {
          console.log("Using AppKit call for owner");
          const result = await executeAppKitCall(
            contractAddress,
            abi,
            'owner',
            []
          );
          // Decode the result (owner returns an address)
          owner = new ethers.Interface(abi).decodeFunctionResult('owner', result)[0];
        } else {
          // Use traditional ethers.js for MetaMask
          owner = await contracts.deedNFT.owner();
        }
        
        console.log(`Contract owner: ${owner}`);
        if (owner.toLowerCase() === address.toLowerCase()) {
          userRolesList.push('OWNER');
        }
      } catch (error) {
        console.log('Contract does not have owner() function or error occurred:', error);
      }

      console.log('User roles found:', userRolesList);
      setUserRoles(userRolesList);
    } catch (error) {
      console.error('Error loading user roles:', error);
    } finally {
      setIsLoadingRoles(false);
    }
  };

  const handleRoleAction = async () => {
    if (!contracts.deedNFT) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (!ethers.isAddress(roleForm.targetAddress)) {
        throw new Error("Invalid address format");
      }

      const role = roleForm.role;
      const targetAddress = roleForm.targetAddress;

      if (roleForm.action === "grant") {
        await contracts.deedNFT.grantRole(role, targetAddress);
        setSuccess(`Role granted to ${targetAddress}`);
      } else {
        await contracts.deedNFT.revokeRole(role, targetAddress);
        setSuccess(`Role revoked from ${targetAddress}`);
      }

      // Reset form
      setRoleForm({
        targetAddress: "",
        selectedContract: "deedNFT",
        role: ROLES.VALIDATOR_ROLE,
        action: "grant"
      });

    } catch (err) {
      console.error("Role action error:", err);
      setError(err instanceof Error ? err.message : "Failed to perform role action");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeedNFTAction = async (action: string) => {
    if (!contracts.deedNFT) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      switch (action) {
        case "pause":
          await contracts.deedNFT.pause();
          setSuccess("Contract paused successfully");
          break;
        case "unpause":
          await contracts.deedNFT.unpause();
          setSuccess("Contract unpaused successfully");
          break;
        case "setContractURI":
          await contracts.deedNFT.setContractURI(deedNFTForm.contractURI);
          setSuccess("Contract URI updated successfully");
          break;
        case "setTraitName":
          const traitKey = ethers.keccak256(ethers.toUtf8Bytes(deedNFTForm.traitKey));
          await contracts.deedNFT.setTraitName(traitKey, deedNFTForm.traitName);
          setSuccess("Trait name set successfully");
          break;
        case "setApprovedMarketplace":
          await contracts.deedNFT.setApprovedMarketplace(deedNFTForm.marketplace, deedNFTForm.marketplaceApproved);
          setSuccess(`Marketplace ${deedNFTForm.marketplaceApproved ? 'approved' : 'disapproved'} successfully`);
          break;
        case "setRoyaltyEnforcement":
          await contracts.deedNFT.setRoyaltyEnforcement(deedNFTForm.enforceRoyalties);
          setSuccess(`Royalty enforcement ${deedNFTForm.enforceRoyalties ? 'enabled' : 'disabled'} successfully`);
          break;
        case "setTransferValidator":
          await contracts.deedNFT.setTransferValidator(deedNFTForm.transferValidator);
          setSuccess("Transfer validator set successfully");
          break;
        case "setFundManager":
          await contracts.deedNFT.setFundManager(deedNFTForm.fundManager);
          setSuccess("Fund manager set successfully");
          break;
        default:
          throw new Error("Unknown action");
      }
    } catch (err) {
      console.error("DeedNFT action error:", err);
      setError(err instanceof Error ? err.message : "Failed to perform DeedNFT action");
    } finally {
      setIsLoading(false);
    }
  };

  const handleValidatorAction = async (action: string) => {
    if (!contracts.validatorRegistry) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Get validator address from registry
      const validators = await contracts.validatorRegistry.getValidators();
      if (validators.length === 0) {
        throw new Error("No validators found in registry");
      }

      const validatorAddress = validators[0]; // Use first validator for now
      if (!chainId) {
        throw new Error("No network detected");
      }
      const validatorAbi = await getValidatorAbi(chainId);
      const validatorContract = new ethers.Contract(validatorAddress, validatorAbi, await contracts.deedNFT.runner);

      switch (action) {
        case "setServiceFee":
          const fee = ethers.parseEther(validatorForm.serviceFee);
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for setServiceFee");
            const tx = await executeAppKitTransaction(
              validatorAddress,
              validatorAbi,
              'setServiceFee',
              [validatorForm.tokenAddress, fee]
            );
            console.log("AppKit setServiceFee transaction executed:", tx);
          } else {
            await validatorContract.setServiceFee(validatorForm.tokenAddress, fee);
          }
          setSuccess("Service fee set successfully");
          break;
        case "addWhitelistedToken":
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for addWhitelistedToken");
            const tx = await executeAppKitTransaction(
              validatorAddress,
              validatorAbi,
              'addWhitelistedToken',
              [validatorForm.tokenAddress]
            );
            console.log("AppKit addWhitelistedToken transaction executed:", tx);
          } else {
            await validatorContract.addWhitelistedToken(validatorForm.tokenAddress);
          }
          setSuccess("Token whitelisted successfully");
          break;
        case "removeWhitelistedToken":
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for removeWhitelistedToken");
            const tx = await executeAppKitTransaction(
              validatorAddress,
              validatorAbi,
              'removeWhitelistedToken',
              [validatorForm.tokenAddress]
            );
            console.log("AppKit removeWhitelistedToken transaction executed:", tx);
          } else {
            await validatorContract.removeWhitelistedToken(validatorForm.tokenAddress);
          }
          setSuccess("Token removed from whitelist successfully");
          break;
        case "registerOperatingAgreement":
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for registerOperatingAgreement");
            const tx = await executeAppKitTransaction(
              validatorAddress,
              validatorAbi,
              'registerOperatingAgreement',
              [validatorForm.operatingAgreementUri, validatorForm.agreementName]
            );
            console.log("AppKit registerOperatingAgreement transaction executed:", tx);
          } else {
            await validatorContract.registerOperatingAgreement(validatorForm.operatingAgreementUri, validatorForm.agreementName);
          }
          setSuccess("Operating agreement registered successfully");
          break;
        case "setRoyaltyFeePercentage":
          const percentage = parseInt(validatorForm.royaltyPercentage);
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for setRoyaltyFeePercentage");
            const tx = await executeAppKitTransaction(
              validatorAddress,
              validatorAbi,
              'setRoyaltyFeePercentage',
              [percentage]
            );
            console.log("AppKit setRoyaltyFeePercentage transaction executed:", tx);
          } else {
            await validatorContract.setRoyaltyFeePercentage(percentage);
          }
          setSuccess("Royalty fee percentage set successfully");
          break;
        case "setRoyaltyReceiver":
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for setRoyaltyReceiver");
            const tx = await executeAppKitTransaction(
              validatorAddress,
              validatorAbi,
              'setRoyaltyReceiver',
              [validatorForm.royaltyReceiver]
            );
            console.log("AppKit setRoyaltyReceiver transaction executed:", tx);
          } else {
            await validatorContract.setRoyaltyReceiver(validatorForm.royaltyReceiver);
          }
          setSuccess("Royalty receiver set successfully");
          break;
        default:
          throw new Error("Unknown action");
      }
    } catch (err) {
      console.error("Validator action error:", err);
      setError(err instanceof Error ? err.message : "Failed to perform validator action");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFundManagerAction = async (action: string) => {
    if (!contracts.fundManager) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      switch (action) {
        case "setCommissionPercentage":
          const percentage = parseInt(fundManagerForm.commissionPercentage);
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for setCommissionPercentage");
            const fundManagerAddress = await contracts.deedNFT.fundManager();
            const fundManagerAbi = await getFundManagerAbi(chainId!);
            const tx = await executeAppKitTransaction(
              fundManagerAddress,
              fundManagerAbi,
              'setCommissionPercentage',
              [percentage]
            );
            console.log("AppKit setCommissionPercentage transaction executed:", tx);
          } else {
            await contracts.fundManager.setCommissionPercentage(percentage);
          }
          setSuccess("Commission percentage set successfully");
          break;
        case "setFeeReceiver":
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for setFeeReceiver");
            const fundManagerAddress = await contracts.deedNFT.fundManager();
            const fundManagerAbi = await getFundManagerAbi(chainId!);
            const tx = await executeAppKitTransaction(
              fundManagerAddress,
              fundManagerAbi,
              'setFeeReceiver',
              [fundManagerForm.feeReceiver]
            );
            console.log("AppKit setFeeReceiver transaction executed:", tx);
          } else {
            await contracts.fundManager.setFeeReceiver(fundManagerForm.feeReceiver);
          }
          setSuccess("Fee receiver set successfully");
          break;
        case "setValidatorRegistry":
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for setValidatorRegistry");
            const fundManagerAddress = await contracts.deedNFT.fundManager();
            const fundManagerAbi = await getFundManagerAbi(chainId!);
            const tx = await executeAppKitTransaction(
              fundManagerAddress,
              fundManagerAbi,
              'setValidatorRegistry',
              [fundManagerForm.validatorRegistry]
            );
            console.log("AppKit setValidatorRegistry transaction executed:", tx);
          } else {
            await contracts.fundManager.setValidatorRegistry(fundManagerForm.validatorRegistry);
          }
          setSuccess("Validator registry set successfully");
          break;
        case "addCompatibleDeedNFT":
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for addCompatibleDeedNFT");
            const fundManagerAddress = await contracts.deedNFT.fundManager();
            const fundManagerAbi = await getFundManagerAbi(chainId!);
            const tx = await executeAppKitTransaction(
              fundManagerAddress,
              fundManagerAbi,
              'addCompatibleDeedNFT',
              [fundManagerForm.deedNFTAddress]
            );
            console.log("AppKit addCompatibleDeedNFT transaction executed:", tx);
          } else {
            await contracts.fundManager.addCompatibleDeedNFT(fundManagerForm.deedNFTAddress);
          }
          setSuccess("Compatible DeedNFT added successfully");
          break;
        case "removeCompatibleDeedNFT":
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for removeCompatibleDeedNFT");
            const fundManagerAddress = await contracts.deedNFT.fundManager();
            const fundManagerAbi = await getFundManagerAbi(chainId!);
            const tx = await executeAppKitTransaction(
              fundManagerAddress,
              fundManagerAbi,
              'removeCompatibleDeedNFT',
              [fundManagerForm.deedNFTAddress]
            );
            console.log("AppKit removeCompatibleDeedNFT transaction executed:", tx);
          } else {
            await contracts.fundManager.removeCompatibleDeedNFT(fundManagerForm.deedNFTAddress);
          }
          setSuccess("Compatible DeedNFT removed successfully");
          break;
        case "addWhitelistedToken":
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for addWhitelistedToken (FundManager)");
            const fundManagerAddress = await contracts.deedNFT.fundManager();
            const fundManagerAbi = await getFundManagerAbi(chainId!);
            const tx = await executeAppKitTransaction(
              fundManagerAddress,
              fundManagerAbi,
              'addWhitelistedToken',
              [fundManagerForm.tokenAddress]
            );
            console.log("AppKit addWhitelistedToken (FundManager) transaction executed:", tx);
          } else {
            await contracts.fundManager.addWhitelistedToken(fundManagerForm.tokenAddress);
          }
          setSuccess("Token whitelisted successfully");
          break;
        case "removeWhitelistedToken":
          if (walletProvider && embeddedWalletInfo) {
            console.log("Using AppKit transaction system for removeWhitelistedToken (FundManager)");
            const fundManagerAddress = await contracts.deedNFT.fundManager();
            const fundManagerAbi = await getFundManagerAbi(chainId!);
            const tx = await executeAppKitTransaction(
              fundManagerAddress,
              fundManagerAbi,
              'removeWhitelistedToken',
              [fundManagerForm.tokenAddress]
            );
            console.log("AppKit removeWhitelistedToken (FundManager) transaction executed:", tx);
          } else {
            await contracts.fundManager.removeWhitelistedToken(fundManagerForm.tokenAddress);
          }
          setSuccess("Token removed from whitelist successfully");
          break;
        default:
          throw new Error("Unknown action");
      }
    } catch (err) {
      console.error("FundManager action error:", err);
      setError(err instanceof Error ? err.message : "Failed to perform FundManager action");
    } finally {
      setIsLoading(false);
    }
  };

  const handleValidatorRegistryAction = async (action: string) => {
    if (!contracts.validatorRegistry) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      switch (action) {
        case "registerValidator":
          const assetTypes = validatorRegistryForm.supportedAssetTypes
            .split(',')
            .map(s => s.trim())
            .filter(s => s)
            .map(s => parseInt(s));
          
          await contracts.validatorRegistry.registerValidator(
            validatorRegistryForm.validatorAddress,
            validatorRegistryForm.validatorName,
            validatorRegistryForm.validatorDescription,
            assetTypes
          );
          setSuccess("Validator registered successfully");
          break;
        default:
          throw new Error("Unknown action");
      }
    } catch (err) {
      console.error("ValidatorRegistry action error:", err);
      setError(err instanceof Error ? err.message : "Failed to perform ValidatorRegistry action");
    } finally {
      setIsLoading(false);
    }
  };

  const hasAdminRole = userRoles.length > 0;

  if (!isWalletConnected) {
    return (
      <div className="container mx-auto py-12 px-4">
        <div className="text-center text-gray-600 dark:text-gray-300 text-lg py-12">
          <Shield className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p>Please connect your wallet to access the admin panel.</p>
        </div>
      </div>
    );
  }

  if (!isCorrectNetwork) {
    return (
      <div className="container mx-auto py-12 px-4">
        <NetworkWarning />
        <div className="text-center text-gray-600 dark:text-gray-300 text-lg py-12">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p>Please switch to a network with deployed contracts to access the admin panel.</p>
        </div>
      </div>
    );
  }

  if (isLoadingRoles) {
    return (
      <div className="container mx-auto py-12 px-4">
        <div className="text-center text-gray-600 dark:text-gray-300 text-lg py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600 mx-auto mb-4"></div>
          <p>Checking admin privileges...</p>
        </div>
      </div>
    );
  }

  if (!hasAdminRole) {
    return (
      <div className="container mx-auto py-12 px-4">
        <div className="text-center text-gray-600 dark:text-gray-300 text-lg py-12">
          <Lock className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p>You don't have admin privileges. Only users with admin roles can access this panel.</p>
          <div className="mt-4">
            <p className="text-sm text-gray-500">Your roles: {userRoles.length > 0 ? userRoles.join(', ') : 'None'}</p>
            <p className="text-sm text-gray-500 mt-2">Address: {address}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-12 px-4">
      
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
                    <h1 className="text-[8vw] lg:text-5xl font-bold text-gray-900 dark:text-white mb-2 font-coolvetica">
          ADMIN PANEL
        </h1>
            <p className="text-gray-600 dark:text-gray-300">
              Manage contract configurations and roles. You have the following roles: {userRoles.join(', ')}
            </p>
          </div>
        </div>
      </div>

      {/* Debug Information */}
      {isWalletConnected && isCorrectNetwork && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-blue-800 dark:text-blue-200 text-sm">
            <strong>Debug Info:</strong> Chain ID: {chainId}, Contract: {chainId ? getContractAddressForNetwork(chainId) : 'Not found'}, 
            Address: {address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : 'None'}
            {embeddedWalletInfo && (
              <span className="ml-2">
                | Embedded Wallet: {embeddedWalletInfo.authProvider} ({embeddedWalletInfo.accountType})
              </span>
            )}
          </p>
          <p className="text-blue-700 dark:text-blue-300 text-xs mt-1">
            Connection Status: {isConnected ? 'Connected' : 'Disconnected'} | 
            Network: {isCorrectNetwork ? 'Correct' : 'Incorrect'} | 
            User Roles: {userRoles.join(', ')}
          </p>
        </div>
      )}

      {/* Error and Success Messages */}
      {error && (
        <div className="mb-6">
          <Alert className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
            <AlertDescription className="text-red-700 dark:text-red-300">{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {success && (
        <div className="mb-6">
          <Alert className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
            <AlertDescription className="text-green-700 dark:text-green-300">{success}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5 bg-gray-100 dark:bg-gray-800 mb-8">
          <TabsTrigger value="deednft" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">
            <Database className="w-4 h-4 mr-2 hidden md:inline" />
            DeedNFT
          </TabsTrigger>
          <TabsTrigger value="roles" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">
            <Users className="w-4 h-4 mr-2 hidden md:inline" />
            Roles
          </TabsTrigger>
          <TabsTrigger value="validator" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">
            <Shield className="w-4 h-4 mr-2 hidden md:inline" />
            Validator
          </TabsTrigger>
          <TabsTrigger value="fundmanager" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">
            <DollarSign className="w-4 h-4 mr-2 hidden md:inline" />
            <span className="md:hidden">Funds</span>
            <span className="hidden md:inline">FundManager</span>
          </TabsTrigger>
          <TabsTrigger value="registry" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700">
            <FileText className="w-4 h-4 mr-2 hidden md:inline" />
            Registry
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deednft" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Pause/Unpause */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Contract State</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleDeedNFTAction("pause")}
                    disabled={isLoading}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    <Lock className="w-4 h-4 mr-2" />
                    Pause
                  </Button>
                  <Button
                    onClick={() => handleDeedNFTAction("unpause")}
                    disabled={isLoading}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    <Unlock className="w-4 h-4 mr-2" />
                    Unpause
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Contract URI */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Contract URI</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="ipfs://..."
                  value={deedNFTForm.contractURI}
                  onChange={(e) => setDeedNFTForm((prev: typeof deedNFTForm) => ({ ...prev, contractURI: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Button
                  onClick={() => handleDeedNFTAction("setContractURI")}
                  disabled={isLoading || !deedNFTForm.contractURI}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11"
                >
                  Update URI
                </Button>
              </CardContent>
            </Card>

            {/* Trait Names */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Trait Names</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Trait key"
                  value={deedNFTForm.traitKey}
                  onChange={(e) => setDeedNFTForm((prev: typeof deedNFTForm) => ({ ...prev, traitKey: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Input
                  placeholder="Trait name"
                  value={deedNFTForm.traitName}
                  onChange={(e) => setDeedNFTForm((prev: typeof deedNFTForm) => ({ ...prev, traitName: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Button
                  onClick={() => handleDeedNFTAction("setTraitName")}
                  disabled={isLoading || !deedNFTForm.traitKey || !deedNFTForm.traitName}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11"
                >
                  Set Trait Name
                </Button>
              </CardContent>
            </Card>

            {/* Marketplace Management */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Marketplace</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Marketplace address"
                  value={deedNFTForm.marketplace}
                  onChange={(e) => setDeedNFTForm((prev: typeof deedNFTForm) => ({ ...prev, marketplace: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="marketplaceApproved"
                    checked={deedNFTForm.marketplaceApproved}
                    onCheckedChange={(checked) => setDeedNFTForm(prev => ({ ...prev, marketplaceApproved: Boolean(checked) }))}
                  />
                  <Label htmlFor="marketplaceApproved">Approved</Label>
                </div>
                <Button
                  onClick={() => handleDeedNFTAction("setApprovedMarketplace")}
                  disabled={isLoading || !deedNFTForm.marketplace}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11"
                >
                  Update Marketplace
                </Button>
              </CardContent>
            </Card>

            {/* Royalty Enforcement */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Royalty Enforcement</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enforceRoyalties"
                    checked={deedNFTForm.enforceRoyalties}
                    onCheckedChange={(checked) => setDeedNFTForm(prev => ({ ...prev, enforceRoyalties: Boolean(checked) }))}
                  />
                  <Label htmlFor="enforceRoyalties">Enforce Royalties</Label>
                </div>
                <Button
                  onClick={() => handleDeedNFTAction("setRoyaltyEnforcement")}
                  disabled={isLoading}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11"
                >
                  Update Royalty Enforcement
                </Button>
              </CardContent>
            </Card>

            {/* Transfer Validator */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Transfer Validator</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Validator address"
                  value={deedNFTForm.transferValidator}
                  onChange={(e) => setDeedNFTForm(prev => ({ ...prev, transferValidator: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Button
                  onClick={() => handleDeedNFTAction("setTransferValidator")}
                  disabled={isLoading || !deedNFTForm.transferValidator}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11"
                >
                  Set Transfer Validator
                </Button>
              </CardContent>
            </Card>

            {/* Fund Manager */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Fund Manager</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Fund manager address"
                  value={deedNFTForm.fundManager}
                  onChange={(e) => setDeedNFTForm(prev => ({ ...prev, fundManager: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Button
                  onClick={() => handleDeedNFTAction("setFundManager")}
                  disabled={isLoading || !deedNFTForm.fundManager}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11"
                >
                  Set Fund Manager
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="roles" className="space-y-6">
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Role Management</CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-300">Grant or revoke roles for addresses</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row gap-4 w-full">
                {/* Contract Selector */}
                <div className="w-full md:w-1/4 space-y-2">
                  <Label className="text-sm font-medium">Contract</Label>
                  <Select
                    value={roleForm.selectedContract}
                    onValueChange={(value) => setRoleForm((prev: RoleFormState) => ({ ...prev, selectedContract: value, role: contractRoles[value as keyof typeof contractRoles][0].value }))}
                  >
                    <SelectTrigger className="w-full border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deedNFT">DeedNFT</SelectItem>
                      <SelectItem value="validator">Validator</SelectItem>
                      <SelectItem value="fundManager">FundManager</SelectItem>
                      <SelectItem value="validatorRegistry">ValidatorRegistry</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Target Address */}
                <div className="w-full md:w-1/4 space-y-2">
                  <Label className="text-sm font-medium">Target Address</Label>
                  <Input
                    placeholder="0x..."
                    value={roleForm.targetAddress}
                    onChange={(e) => setRoleForm((prev: RoleFormState) => ({ ...prev, targetAddress: e.target.value }))}
                    className="w-full border-black/10 dark:border-white/10 h-11"
                  />
                </div>
                {/* Role Dropdown */}
                <div className="w-full md:w-1/4 space-y-2">
                  <Label className="text-sm font-medium">Role</Label>
                  <Select
                    value={roleForm.role}
                    onValueChange={(value) => setRoleForm((prev: RoleFormState) => ({ ...prev, role: value }))}
                  >
                    <SelectTrigger className="w-full border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {contractRoles[roleForm.selectedContract as keyof typeof contractRoles].map((role) => (
                        <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Action Dropdown */}
                <div className="w-full md:w-1/4 space-y-2">
                  <Label className="text-sm font-medium">Action</Label>
                  <Select
                    value={roleForm.action}
                    onValueChange={(value) => setRoleForm((prev: RoleFormState) => ({ ...prev, action: value }))}
                  >
                    <SelectTrigger className="w-full border-black/10 dark:border-white/10 bg-white dark:bg-[#141414] text-gray-900 dark:text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="grant">
                        <UserPlus className="w-4 h-4 mr-2" />
                        Grant
                      </SelectItem>
                      <SelectItem value="revoke">
                        <UserMinus className="w-4 h-4 mr-2" />
                        Revoke
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                onClick={handleRoleAction}
                disabled={isLoading || !roleForm.targetAddress}
                className="w-full mt-4 bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11"
              >
                {isLoading ? 'Processing...' : `${roleForm.action === 'grant' ? 'Grant' : 'Revoke'} Role`}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="validator" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Service Fees */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Service Fees</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Token address"
                  value={validatorForm.tokenAddress}
                  onChange={(e) => setValidatorForm((prev: typeof validatorForm) => ({ ...prev, tokenAddress: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Input
                  placeholder="Service fee (ETH)"
                  value={validatorForm.serviceFee}
                  onChange={(e) => setValidatorForm((prev: typeof validatorForm) => ({ ...prev, serviceFee: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Button
                  onClick={() => handleValidatorAction("setServiceFee")}
                  disabled={isLoading || !validatorForm.tokenAddress || !validatorForm.serviceFee}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11"
                >
                  Set Service Fee
                </Button>
              </CardContent>
            </Card>

            {/* Token Whitelist */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Token Whitelist</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Token address"
                  value={validatorForm.tokenAddress}
                  onChange={(e) => setValidatorForm((prev: typeof validatorForm) => ({ ...prev, tokenAddress: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleValidatorAction("addWhitelistedToken")}
                    disabled={isLoading || !validatorForm.tokenAddress}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    Add Token
                  </Button>
                  <Button
                    onClick={() => handleValidatorAction("removeWhitelistedToken")}
                    disabled={isLoading || !validatorForm.tokenAddress}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    Remove Token
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Operating Agreements */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Operating Agreements</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Agreement URI"
                  value={validatorForm.operatingAgreementUri}
                  onChange={(e) => setValidatorForm((prev: typeof validatorForm) => ({ ...prev, operatingAgreementUri: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Input
                  placeholder="Agreement name"
                  value={validatorForm.agreementName}
                  onChange={(e) => setValidatorForm((prev: typeof validatorForm) => ({ ...prev, agreementName: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Button
                  onClick={() => handleValidatorAction("registerOperatingAgreement")}
                  disabled={isLoading || !validatorForm.operatingAgreementUri || !validatorForm.agreementName}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11"
                >
                  Register Agreement
                </Button>
              </CardContent>
            </Card>

            {/* Royalty Settings */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Royalty Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Royalty percentage (basis points)"
                  value={validatorForm.royaltyPercentage}
                  onChange={(e) => setValidatorForm((prev: typeof validatorForm) => ({ ...prev, royaltyPercentage: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Input
                  placeholder="Royalty receiver address"
                  value={validatorForm.royaltyReceiver}
                  onChange={(e) => setValidatorForm((prev: typeof validatorForm) => ({ ...prev, royaltyReceiver: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleValidatorAction("setRoyaltyFeePercentage")}
                    disabled={isLoading || !validatorForm.royaltyPercentage}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    Set Percentage
                  </Button>
                  <Button
                    onClick={() => handleValidatorAction("setRoyaltyReceiver")}
                    disabled={isLoading || !validatorForm.royaltyReceiver}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    Set Receiver
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="fundmanager" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Commission Settings */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Commission Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Commission percentage (basis points)"
                  value={fundManagerForm.commissionPercentage}
                  onChange={(e) => setFundManagerForm((prev: typeof fundManagerForm) => ({ ...prev, commissionPercentage: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Input
                  placeholder="Fee receiver address"
                  value={fundManagerForm.feeReceiver}
                  onChange={(e) => setFundManagerForm((prev: typeof fundManagerForm) => ({ ...prev, feeReceiver: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleFundManagerAction("setCommissionPercentage")}
                    disabled={isLoading || !fundManagerForm.commissionPercentage}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    Set Commission
                  </Button>
                  <Button
                    onClick={() => handleFundManagerAction("setFeeReceiver")}
                    disabled={isLoading || !fundManagerForm.feeReceiver}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    Set Receiver
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Validator Registry */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Validator Registry</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Validator registry address"
                  value={fundManagerForm.validatorRegistry}
                  onChange={(e) => setFundManagerForm((prev: typeof fundManagerForm) => ({ ...prev, validatorRegistry: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <Button
                  onClick={() => handleFundManagerAction("setValidatorRegistry")}
                  disabled={isLoading || !fundManagerForm.validatorRegistry}
                  className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11"
                >
                  Set Registry
                </Button>
              </CardContent>
            </Card>

            {/* Compatible DeedNFTs */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Compatible DeedNFTs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="DeedNFT address"
                  value={fundManagerForm.deedNFTAddress}
                  onChange={(e) => setFundManagerForm((prev: typeof fundManagerForm) => ({ ...prev, deedNFTAddress: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleFundManagerAction("addCompatibleDeedNFT")}
                    disabled={isLoading || !fundManagerForm.deedNFTAddress}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    Add DeedNFT
                  </Button>
                  <Button
                    onClick={() => handleFundManagerAction("removeCompatibleDeedNFT")}
                    disabled={isLoading || !fundManagerForm.deedNFTAddress}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    Remove DeedNFT
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Token Whitelist */}
            <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Token Whitelist</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Token address"
                  value={fundManagerForm.tokenAddress}
                  onChange={(e) => setFundManagerForm((prev: typeof fundManagerForm) => ({ ...prev, tokenAddress: e.target.value }))}
                  className="border-black/10 dark:border-white/10 h-11"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleFundManagerAction("addWhitelistedToken")}
                    disabled={isLoading || !fundManagerForm.tokenAddress}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    Add Token
                  </Button>
                  <Button
                    onClick={() => handleFundManagerAction("removeWhitelistedToken")}
                    disabled={isLoading || !fundManagerForm.tokenAddress}
                    variant="outline"
                    className="flex-1 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] h-11"
                  >
                    Remove Token
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="registry" className="space-y-6">
          <Card className="border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#141414]/90 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">Validator Registry</CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-300">Register new validators in the registry</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Validator Address</Label>
                  <Input
                    placeholder="0x..."
                    value={validatorRegistryForm.validatorAddress}
                    onChange={(e) => setValidatorRegistryForm((prev: typeof validatorRegistryForm) => ({ ...prev, validatorAddress: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Validator Name</Label>
                  <Input
                    placeholder="Validator name"
                    value={validatorRegistryForm.validatorName}
                    onChange={(e) => setValidatorRegistryForm((prev: typeof validatorRegistryForm) => ({ ...prev, validatorName: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>
                <div className="md:col-span-2 space-y-2">
                  <Label className="text-sm font-medium">Description</Label>
                  <Textarea
                    placeholder="Validator description"
                    value={validatorRegistryForm.validatorDescription}
                    onChange={(e) => setValidatorRegistryForm((prev: typeof validatorRegistryForm) => ({ ...prev, validatorDescription: e.target.value }))}
                    className="border-black/10 dark:border-white/10"
                  />
                </div>
                <div className="md:col-span-2 space-y-2">
                  <Label className="text-sm font-medium">Supported Asset Types (comma-separated)</Label>
                  <Input
                    placeholder="0,1,2,3"
                    value={validatorRegistryForm.supportedAssetTypes}
                    onChange={(e) => setValidatorRegistryForm((prev: typeof validatorRegistryForm) => ({ ...prev, supportedAssetTypes: e.target.value }))}
                    className="border-black/10 dark:border-white/10 h-11"
                  />
                </div>
              </div>
              <Button
                onClick={() => handleValidatorRegistryAction("registerValidator")}
                disabled={isLoading || !validatorRegistryForm.validatorAddress || !validatorRegistryForm.validatorName}
                className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] dark:text-white text-white font-semibold py-3 rounded-lg transition-colors duration-200 border border-white/10 h-11"
              >
                Register Validator
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminPanel; 