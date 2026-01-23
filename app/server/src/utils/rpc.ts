/**
 * Shared RPC utilities for blockchain interactions
 */

/**
 * Get RPC URL for a chain
 * Consolidated from all services to ensure consistency
 */
export function getRpcUrl(chainId: number): string {
  const rpcUrls: Record<number, string> = {
    // Mainnets
    1: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    8453: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    100: process.env.GNOSIS_RPC_URL || 'https://rpc.gnosischain.com',
    137: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    42161: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    
    // Testnets
    11155111: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
    84532: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    80001: process.env.MUMBAI_RPC_URL || 'https://rpc-mumbai.maticvigil.com',
  };

  return rpcUrls[chainId] || '';
}

/**
 * Check if RPC URL is available for a chain
 */
export function hasRpcUrl(chainId: number): boolean {
  return !!getRpcUrl(chainId);
}
