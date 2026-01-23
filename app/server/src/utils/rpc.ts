/**
 * Shared RPC utilities for blockchain interactions
 */

/**
 * Get Alchemy RPC URL for a chain using API key
 */
function getAlchemyUrl(chainId: number, apiKey: string): string | undefined {
  const alchemyUrls: Record<number, string> = {
    // Mainnets
    1: `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`,
    8453: `https://base-mainnet.g.alchemy.com/v2/${apiKey}`,
    137: `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`,
    42161: `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`,
    100: `https://gnosis-mainnet.g.alchemy.com/v2/${apiKey}`,
    
    // Testnets
    11155111: `https://eth-sepolia.g.alchemy.com/v2/${apiKey}`,
    84532: `https://base-sepolia.g.alchemy.com/v2/${apiKey}`,
    80001: `https://polygon-mumbai.g.alchemy.com/v2/${apiKey}`,
  };

  return alchemyUrls[chainId] || undefined;
}

/**
 * Get RPC URL for a chain
 * Priority: Custom URL > Alchemy (if API key provided) > Public fallback
 * Consolidated from all services to ensure consistency
 */
export function getRpcUrl(chainId: number): string {
  const alchemyApiKey = process.env.ALCHEMY_API_KEY;
  
  const rpcUrls: Record<number, { custom?: string; alchemy?: string; fallback: string }> = {
    // Mainnets
    1: {
      custom: process.env.ETHEREUM_RPC_URL,
      alchemy: alchemyApiKey ? getAlchemyUrl(1, alchemyApiKey) : undefined,
      fallback: 'https://eth.llamarpc.com',
    },
    8453: {
      custom: process.env.BASE_RPC_URL,
      alchemy: alchemyApiKey ? getAlchemyUrl(8453, alchemyApiKey) : undefined,
      fallback: 'https://mainnet.base.org',
    },
    100: {
      custom: process.env.GNOSIS_RPC_URL,
      alchemy: alchemyApiKey ? getAlchemyUrl(100, alchemyApiKey) : undefined,
      fallback: 'https://rpc.gnosischain.com',
    },
    137: {
      custom: process.env.POLYGON_RPC_URL,
      alchemy: alchemyApiKey ? getAlchemyUrl(137, alchemyApiKey) : undefined,
      fallback: 'https://polygon-rpc.com',
    },
    42161: {
      custom: process.env.ARBITRUM_RPC_URL,
      alchemy: alchemyApiKey ? getAlchemyUrl(42161, alchemyApiKey) : undefined,
      fallback: 'https://arb1.arbitrum.io/rpc',
    },
    
    // Testnets
    11155111: {
      custom: process.env.SEPOLIA_RPC_URL,
      alchemy: alchemyApiKey ? getAlchemyUrl(11155111, alchemyApiKey) : undefined,
      fallback: 'https://rpc.sepolia.org',
    },
    84532: {
      custom: process.env.BASE_SEPOLIA_RPC_URL,
      alchemy: alchemyApiKey ? getAlchemyUrl(84532, alchemyApiKey) : undefined,
      fallback: 'https://sepolia.base.org',
    },
    80001: {
      custom: process.env.MUMBAI_RPC_URL,
      alchemy: alchemyApiKey ? getAlchemyUrl(80001, alchemyApiKey) : undefined,
      fallback: 'https://rpc-mumbai.maticvigil.com',
    },
  };

  const config = rpcUrls[chainId];
  if (!config) return '';

  // Priority: Custom URL > Alchemy > Fallback
  return config.custom || config.alchemy || config.fallback;
}

/**
 * Check if RPC URL is available for a chain
 */
export function hasRpcUrl(chainId: number): boolean {
  return !!getRpcUrl(chainId);
}
