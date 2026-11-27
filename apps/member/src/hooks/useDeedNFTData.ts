import { useDeedNFTContext } from '@/context/DeedNFTContext';

// Re-export types from context
export type { DeedNFT, DeedNFTStats } from '@/context/DeedNFTContext';

export const useDeedNFTData = () => {
  const context = useDeedNFTContext();

  return {
    ...context,
    // Keep the same interface for backward compatibility
    deedNFTs: context.deedNFTs,
    userDeedNFTs: context.userDeedNFTs,
    stats: context.stats,
    loading: context.loading,
    error: context.error,
    fetchDeedNFTs: context.fetchDeedNFTs,
    getAssetTypeLabel: context.getAssetTypeLabel,
    getAssetTypeDescription: context.getAssetTypeDescription,
    getValidationStatus: context.getValidationStatus,
    isConnected: context.isConnected,
    isCorrectNetwork: context.isCorrectNetwork,
    currentChainId: context.currentChainId,
    contractAddress: context.contractAddress,
    address: context.address
  };
}; 