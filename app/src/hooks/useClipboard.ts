import { useCallback, useState, useEffect } from 'react';

/**
 * Hook for Clipboard API operations
 */
export function useClipboard() {
  const [isSupported, setIsSupported] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setIsSupported('clipboard' in navigator && 'writeText' in navigator.clipboard);
  }, []);

  /**
   * Copy text to clipboard
   */
  const copy = useCallback(async (text: string): Promise<boolean> => {
    if (!isSupported) {
      // Fallback for older browsers
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (success) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          return true;
        }
        return false;
      } catch (error) {
        console.error('[Clipboard] Fallback copy failed:', error);
        return false;
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return true;
    } catch (error) {
      console.error('[Clipboard] Copy failed:', error);
      return false;
    }
  }, [isSupported]);

  /**
   * Copy wallet address (formatted)
   */
  const copyAddress = useCallback(async (address: string): Promise<boolean> => {
    return copy(address);
  }, [copy]);

  /**
   * Copy transaction hash
   */
  const copyTransactionHash = useCallback(async (hash: string): Promise<boolean> => {
    return copy(hash);
  }, [copy]);

  /**
   * Copy portfolio summary as text
   */
  const copyPortfolioSummary = useCallback(async (summary: {
    totalValue: number;
    holdings: number;
    chains: string[];
  }): Promise<boolean> => {
    const text = `Portfolio Summary\nTotal Value: $${summary.totalValue.toLocaleString()}\nHoldings: ${summary.holdings}\nChains: ${summary.chains.join(', ')}`;
    return copy(text);
  }, [copy]);

  /**
   * Read from clipboard
   */
  const read = useCallback(async (): Promise<string | null> => {
    if (!isSupported) {
      return null;
    }

    try {
      const text = await navigator.clipboard.readText();
      return text;
    } catch (error) {
      console.error('[Clipboard] Read failed:', error);
      return null;
    }
  }, [isSupported]);

  return {
    isSupported,
    copied,
    copy,
    copyAddress,
    copyTransactionHash,
    copyPortfolioSummary,
    read,
  };
}
