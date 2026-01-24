import { useCallback } from 'react';

interface ShareData {
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
}

/**
 * Hook for Web Share API
 * Allows sharing portfolio data, NFTs, transactions
 */
export function useShare() {
  const isSupported = 'share' in navigator;

  /**
   * Share data using Web Share API
   */
  const share = useCallback(async (data: ShareData): Promise<boolean> => {
    if (!isSupported) {
      console.warn('[Share] Web Share API not supported');
      // Fallback: copy to clipboard
      if (data.text || data.url) {
        try {
          await navigator.clipboard.writeText(data.text || data.url || '');
          return true;
        } catch (error) {
          console.error('[Share] Clipboard fallback failed:', error);
          return false;
        }
      }
      return false;
    }

    try {
      await navigator.share(data);
      return true;
    } catch (error: any) {
      // User cancelled or error occurred
      if (error.name !== 'AbortError') {
        console.error('[Share] Share failed:', error);
      }
      return false;
    }
  }, [isSupported]);

  /**
   * Share portfolio summary
   */
  const sharePortfolio = useCallback(async (portfolioData: {
    totalValue: number;
    holdings: number;
    chains: string[];
  }) => {
    return share({
      title: 'My Portfolio',
      text: `Check out my portfolio: $${portfolioData.totalValue.toLocaleString()} across ${portfolioData.holdings} holdings on ${portfolioData.chains.join(', ')}`,
      url: window.location.href
    });
  }, [share]);

  /**
   * Share NFT details
   */
  const shareNFT = useCallback(async (nftData: {
    name: string;
    tokenId: string;
    chainId: number;
  }) => {
    return share({
      title: `NFT: ${nftData.name}`,
      text: `Check out this NFT: ${nftData.name} (Token ID: ${nftData.tokenId})`,
      url: `${window.location.origin}/nft/${nftData.chainId}/${nftData.tokenId}`
    });
  }, [share]);

  /**
   * Share transaction
   */
  const shareTransaction = useCallback(async (txData: {
    hash: string;
    chainId: number;
    type: string;
  }) => {
    const explorerUrl = getExplorerUrl(txData.chainId, txData.hash);
    return share({
      title: 'Transaction',
      text: `View my ${txData.type} transaction`,
      url: explorerUrl
    });
  }, [share]);

  return {
    isSupported,
    share,
    sharePortfolio,
    shareNFT,
    shareTransaction,
  };
}

/**
 * Get blockchain explorer URL for a transaction
 */
function getExplorerUrl(chainId: number, hash: string): string {
  const explorers: Record<number, string> = {
    1: `https://etherscan.io/tx/${hash}`,
    8453: `https://basescan.org/tx/${hash}`,
    100: `https://gnosisscan.io/tx/${hash}`,
    11155111: `https://sepolia.etherscan.io/tx/${hash}`,
    84532: `https://sepolia.basescan.org/tx/${hash}`,
  };
  return explorers[chainId] || `https://explorer.chain/${hash}`;
}
