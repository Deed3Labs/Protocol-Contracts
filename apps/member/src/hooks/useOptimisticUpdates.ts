import { useCallback } from 'react';
import { usePortfolio } from '@/context/PortfolioContext';

/**
 * Hook for optimistic UI updates after transactions
 * Updates UI immediately, then refreshes with real data
 */
export function useOptimisticUpdates() {
  const { refreshAll, refreshBalances, refreshHoldings, refreshActivity } = usePortfolio();

  /**
   * Optimistically update balance after a transaction
   */
  const optimisticBalanceUpdate = useCallback(async (
    _chainId: number,
    _address: string,
    _expectedChange: { native?: number; tokens?: Array<{ address: string; change: number }> }
  ) => {
    // Immediately refresh to get updated balance
    await refreshBalances();
    
    // Poll for confirmation (transaction might still be pending)
    let attempts = 0;
    const maxAttempts = 10;
    const pollInterval = 2000; // 2 seconds
    
    const pollForConfirmation = setInterval(async () => {
      attempts++;
      await refreshBalances();
      
      if (attempts >= maxAttempts) {
        clearInterval(pollForConfirmation);
      }
    }, pollInterval);
    
    // Clear interval after 20 seconds max
    setTimeout(() => {
      clearInterval(pollForConfirmation);
    }, maxAttempts * pollInterval);
  }, [refreshBalances]);

  /**
   * Optimistically update NFTs after mint/transfer
   */
  const optimisticNFTUpdate = useCallback(async (_chainId: number, _address: string) => {
    // Immediately refresh holdings
    await refreshHoldings();
    
    // Poll for confirmation
    let attempts = 0;
    const maxAttempts = 10;
    const pollInterval = 2000;
    
    const pollForConfirmation = setInterval(async () => {
      attempts++;
      await refreshHoldings();
      
      if (attempts >= maxAttempts) {
        clearInterval(pollForConfirmation);
      }
    }, pollInterval);
    
    setTimeout(() => {
      clearInterval(pollForConfirmation);
    }, maxAttempts * pollInterval);
  }, [refreshHoldings]);

  /**
   * Optimistically update activity after transaction
   */
  const optimisticActivityUpdate = useCallback(async (_chainId: number, _address: string) => {
    // Immediately refresh activity
    await refreshActivity();
    
    // Poll for confirmation
    let attempts = 0;
    const maxAttempts = 10;
    const pollInterval = 2000;
    
    const pollForConfirmation = setInterval(async () => {
      attempts++;
      await refreshActivity();
      
      if (attempts >= maxAttempts) {
        clearInterval(pollForConfirmation);
      }
    }, pollInterval);
    
    setTimeout(() => {
      clearInterval(pollForConfirmation);
    }, maxAttempts * pollInterval);
  }, [refreshActivity]);

  /**
   * Optimistic update after any transaction
   */
  const optimisticUpdate = useCallback(async (
    chainId: number,
    address: string,
    type: 'mint' | 'transfer' | 'transaction'
  ) => {
    // Refresh all data immediately
    await refreshAll();
    
    // Poll for confirmation based on transaction type
    if (type === 'mint' || type === 'transfer') {
      await optimisticNFTUpdate(chainId, address);
    }
    
    await optimisticActivityUpdate(chainId, address);
    await optimisticBalanceUpdate(chainId, address, {});
  }, [refreshAll, optimisticNFTUpdate, optimisticActivityUpdate, optimisticBalanceUpdate]);

  return {
    optimisticBalanceUpdate,
    optimisticNFTUpdate,
    optimisticActivityUpdate,
    optimisticUpdate,
  };
}
