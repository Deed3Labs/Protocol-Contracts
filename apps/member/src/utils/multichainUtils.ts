import { ethers } from 'ethers';
import { SUPPORTED_NETWORKS, getNetworkByChainId, getContractAddressForNetwork } from '@/config/networks';
import { getEthereumProvider } from './providerUtils';

// Type for ethereum provider request method
type EthereumRequest = (args: { method: string; params?: any[] }) => Promise<any>;

/**
 * Switch to a specific chain if not already on it
 * Returns true if switch was successful or already on the chain
 */
export async function ensureChain(chainId: number): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('No wallet provider available');
    }

    const provider = new ethers.BrowserProvider(window.ethereum as unknown as ethers.Eip1193Provider);
    const network = await provider.getNetwork();
    
    // Already on the correct chain
    if (network.chainId === BigInt(chainId)) {
      return true;
    }

    // Try to switch chain
    try {
      if (!window.ethereum) {
        throw new Error('No wallet provider available');
      }
      const request = (window.ethereum as any).request as EthereumRequest;
      await request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });
      return true;
    } catch (switchError: any) {
      // If chain doesn't exist, try to add it
      if (switchError.code === 4902) {
        const networkConfig = getNetworkByChainId(chainId);
        if (!networkConfig) {
          throw new Error(`Network ${chainId} not supported`);
        }

        if (!window.ethereum) {
          throw new Error('No wallet provider available');
        }
        const request = (window.ethereum as any).request as EthereumRequest;
        await request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: `0x${chainId.toString(16)}`,
              chainName: networkConfig.name,
              nativeCurrency: networkConfig.nativeCurrency,
              rpcUrls: [networkConfig.rpcUrl],
              blockExplorerUrls: [networkConfig.blockExplorer],
            },
          ],
        });
        return true;
      }
      throw switchError;
    }
  } catch (error) {
    console.error(`Error switching to chain ${chainId}:`, error);
    return false;
  }
}

/**
 * Get a provider for a specific chain
 * Will switch to that chain if needed for write operations
 */
export async function getChainProvider(chainId: number, forWrite: boolean = false): Promise<ethers.Provider> {
  if (forWrite) {
    // For write operations, ensure we're on the correct chain
    const switched = await ensureChain(chainId);
    if (!switched) {
      throw new Error(`Failed to switch to chain ${chainId}`);
    }
  }

  try {
    const provider = await getEthereumProvider();
    const network = await provider.getNetwork();
    
    if (network.chainId === BigInt(chainId)) {
      return provider;
    }
  } catch (error) {
    // Fall through to RPC provider
  }

  // For read operations or if wallet provider fails, use RPC provider
  const networkConfig = getNetworkByChainId(chainId);
  if (!networkConfig) {
    throw new Error(`Network ${chainId} not supported`);
  }

  return new ethers.JsonRpcProvider(networkConfig.rpcUrl);
}

/**
 * Execute a transaction on a specific chain
 * Automatically switches to the chain if needed
 */
export async function executeTransactionOnChain(
  chainId: number,
  transaction: ethers.TransactionRequest
): Promise<ethers.TransactionResponse> {
  // Ensure we're on the correct chain
  const switched = await ensureChain(chainId);
  if (!switched) {
    throw new Error(`Failed to switch to chain ${chainId}`);
  }

  const provider = await getEthereumProvider();
  const signer = await provider.getSigner();
  
  return signer.sendTransaction(transaction);
}

/**
 * Get the best chain to use for a transaction based on contract deployment
 */
export function getBestChainForContract(contractName: string): number | null {
  // Check which chains have the contract deployed
  for (const network of SUPPORTED_NETWORKS) {
    const address = getContractAddressForNetwork(network.chainId, contractName);
    if (address && address !== '0x0000000000000000000000000000000000000000') {
      return network.chainId;
    }
  }
  return null;
}
