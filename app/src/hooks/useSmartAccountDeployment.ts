import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { useCallback, useState } from 'react';

export function useSmartAccountDeployment() {
  const { embeddedWalletInfo, status } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider("eip155");
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);

  // Check if using embedded wallet
  const isEmbeddedWallet = embeddedWalletInfo !== null;
  
  // Check if smart account is deployed
  const isSmartAccountDeployed = embeddedWalletInfo?.isSmartAccountDeployed ?? false;
  
  // Check if smart account needs deployment
  const needsDeployment = isEmbeddedWallet && !isSmartAccountDeployed;

  // Function to trigger smart account deployment
  const deploySmartAccount = useCallback(async () => {
    if (!isEmbeddedWallet) {
      throw new Error("Not using embedded wallet");
    }

    if (isSmartAccountDeployed) {
      console.log("Smart account is already deployed");
      return;
    }

    setIsDeploying(true);
    setDeploymentError(null);

    try {
      console.log("Triggering smart account deployment...");
      
      // For AppKit embedded wallets, the deployment is typically triggered
      // by the first transaction. We can trigger it by making a simple
      // transaction or by using AppKit's deployment methods.
      
      if (walletProvider) {
        // Try to trigger deployment by making a simple transaction
        // This will cause AppKit to deploy the smart account automatically
        console.log("Using AppKit wallet provider to trigger deployment");
        
        // You can trigger deployment by making any transaction
        // For now, we'll just log that deployment should be triggered
        // on the next transaction
        console.log("Smart account will be deployed on next transaction");
      } else {
        throw new Error("No wallet provider available");
      }
      
    } catch (error) {
      console.error("Failed to deploy smart account:", error);
      setDeploymentError(error instanceof Error ? error.message : "Failed to deploy smart account");
      throw error;
    } finally {
      setIsDeploying(false);
    }
  }, [isEmbeddedWallet, isSmartAccountDeployed, walletProvider]);

  // Function to check if a transaction will trigger deployment
  const willTriggerDeployment = useCallback(() => {
    if (!isEmbeddedWallet || isSmartAccountDeployed) {
      return false;
    }
    
    // Any transaction from an undeployed smart account will trigger deployment
    return true;
  }, [isEmbeddedWallet, isSmartAccountDeployed]);

  // Function to prepare transaction with deployment handling
  const prepareTransaction = useCallback(async (transactionData: any) => {
    if (needsDeployment) {
      console.log("Smart account needs deployment, transaction will trigger deployment");
      
      // For embedded wallets, the first transaction automatically deploys the smart account
      // We need to ensure the transaction is properly formatted for deployment
      return {
        ...transactionData,
        // Add deployment-specific parameters
        from: embeddedWalletInfo?.user?.email || "embedded-wallet",
        // Ensure gas limit is sufficient for deployment + transaction
        gasLimit: "0x186A0", // 100,000 gas (adjust as needed)
        // Add any other deployment-specific parameters
        type: "0x2", // EIP-1559 transaction type
      };
    }
    
    // For already deployed smart accounts, return transaction as-is
    console.log("Smart account already deployed, using standard transaction");
    return {
      ...transactionData,
      type: "0x2", // EIP-1559 transaction type
    };
  }, [needsDeployment, embeddedWalletInfo]);

  return {
    // Status
    isEmbeddedWallet,
    isSmartAccountDeployed,
    needsDeployment,
    isDeploying,
    deploymentError,
    
    // Smart account info
    embeddedWalletInfo,
    accountType: embeddedWalletInfo?.accountType,
    authProvider: embeddedWalletInfo?.authProvider,
    status,
    
    // Functions
    deploySmartAccount,
    willTriggerDeployment,
    prepareTransaction,
    
    // Helper functions
    canMakeTransaction: isSmartAccountDeployed || isEmbeddedWallet,
    getDeploymentStatus: () => {
      if (!isEmbeddedWallet) return "Not using embedded wallet";
      if (isSmartAccountDeployed) return "Smart account deployed";
      if (isDeploying) return "Deploying smart account...";
      return "Smart account needs deployment";
    }
  };
} 