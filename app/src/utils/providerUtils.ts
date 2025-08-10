import { ethers } from 'ethers';

/**
 * Safely get an Ethereum provider with mobile device support
 * This function handles the case where window.ethereum might not be immediately available on mobile
 */
export const getEthereumProvider = async (): Promise<ethers.BrowserProvider> => {
  // Check if window.ethereum is available
  if (!window.ethereum) {
    throw new Error("No Ethereum provider available. Please ensure MetaMask is installed and connected.");
  }

  // Add a small delay to ensure the provider is properly initialized on mobile
  await new Promise(resolve => setTimeout(resolve, 100));

  // Double-check that ethereum is still available after the delay
  if (!window.ethereum) {
    throw new Error("Ethereum provider not available after initialization delay.");
  }

  return new ethers.BrowserProvider(window.ethereum as any);
};

/**
 * Safely get a signer with mobile device support
 */
export const getEthereumSigner = async (): Promise<ethers.Signer> => {
  const provider = await getEthereumProvider();
  return await provider.getSigner();
};

/**
 * Check if we're on a mobile device
 */
export const isMobileDevice = (): boolean => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

/**
 * Wait for Ethereum provider to be available (useful for mobile deep linking scenarios)
 */
export const waitForEthereumProvider = async (maxWaitTime = 5000): Promise<void> => {
  const startTime = Date.now();
  
  while (!window.ethereum && (Date.now() - startTime) < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  if (!window.ethereum) {
    throw new Error("Ethereum provider not available after waiting");
  }
}; 