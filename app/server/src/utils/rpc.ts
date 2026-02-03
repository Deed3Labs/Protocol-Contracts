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

/**
 * Get Alchemy REST API base URL for a chain
 * Used for Alchemy's REST API endpoints (not RPC)
 */
export function getAlchemyRestUrl(chainId: number): string | null {
  const alchemyApiKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyApiKey) {
    return null;
  }

  const restUrls: Record<number, string> = {
    // Mainnets
    1: `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
    8453: `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
    137: `https://polygon-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
    42161: `https://arb-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
    100: `https://gnosis-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
    
    // Testnets
    11155111: `https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`,
    84532: `https://base-sepolia.g.alchemy.com/v2/${alchemyApiKey}`,
    80001: `https://polygon-mumbai.g.alchemy.com/v2/${alchemyApiKey}`,
  };

  return restUrls[chainId] || null;
}

/**
 * Get Alchemy NFT API base URL for a chain
 * Used for Alchemy's NFT API endpoints (different from REST API)
 * Note: getFloorPrice endpoint is only available on Ethereum mainnet
 * getNFTsForOwner (v3) is available on multiple chains including Base Sepolia
 */
export function getAlchemyNFTUrl(chainId: number): string | null {
  const alchemyApiKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyApiKey) {
    return null;
  }

  // NFT API v3 endpoints by chain
  const nftApiUrls: Record<number, string> = {
    // Mainnets
    1: `https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyApiKey}`,
    8453: `https://base-mainnet.g.alchemy.com/nft/v3/${alchemyApiKey}`,
    137: `https://polygon-mainnet.g.alchemy.com/nft/v3/${alchemyApiKey}`,
    42161: `https://arb-mainnet.g.alchemy.com/nft/v3/${alchemyApiKey}`,
    
    // Testnets
    11155111: `https://eth-sepolia.g.alchemy.com/nft/v3/${alchemyApiKey}`,
    84532: `https://base-sepolia.g.alchemy.com/nft/v3/${alchemyApiKey}`,
  };

  return nftApiUrls[chainId] || null;
}

/**
 * Get Alchemy Prices API base URL
 * Used for Alchemy's Prices API endpoints (unified pricing across chains)
 * https://www.alchemy.com/docs/reference/prices-api-quickstart
 */
export function getAlchemyPricesApiUrl(): string | null {
  const alchemyApiKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyApiKey) {
    return null;
  }
  // Prices API uses a unified endpoint: https://api.g.alchemy.com/prices/v1
  return 'https://api.g.alchemy.com/prices/v1';
}

/**
 * Get Alchemy API key for authentication
 */
export function getAlchemyApiKey(): string | null {
  return process.env.ALCHEMY_API_KEY || null;
}

/**
 * Alchemy WebSocket URL for a chain (wss://...).
 * Use only for eth_subscribe (logs, newHeads) to avoid eth_getFilterChanges polling.
 * @see https://www.alchemy.com/docs/reference/subscription-api
 * @see https://www.alchemy.com/docs/reference/subscription-api-endpoints
 */
function getAlchemyWebSocketUrlInternal(chainId: number, apiKey: string): string | undefined {
  const wssUrls: Record<number, string> = {
    1: `wss://eth-mainnet.g.alchemy.com/v2/${apiKey}`,
    8453: `wss://base-mainnet.g.alchemy.com/v2/${apiKey}`,
    137: `wss://polygon-mainnet.g.alchemy.com/v2/${apiKey}`,
    42161: `wss://arb-mainnet.g.alchemy.com/v2/${apiKey}`,
    100: `wss://gnosis-mainnet.g.alchemy.com/v2/${apiKey}`,
    11155111: `wss://eth-sepolia.g.alchemy.com/v2/${apiKey}`,
    84532: `wss://base-sepolia.g.alchemy.com/v2/${apiKey}`,
    80001: `wss://polygon-mumbai.g.alchemy.com/v2/${apiKey}`,
  };
  return wssUrls[chainId];
}

/**
 * Get Alchemy WebSocket URL for a chain if API key is set.
 * Use for event listening with eth_subscribe to avoid eth_getFilterChanges.
 */
export function getAlchemyWebSocketUrl(chainId: number): string | null {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) return null;
  return getAlchemyWebSocketUrlInternal(chainId, apiKey) ?? null;
}

/**
 * Chains where Alchemy supports eth_subscribe (logs, newHeads) over WebSocket.
 * Per Alchemy docs: Ethereum, Polygon, Arbitrum, Base (4 of our 7 chains).
 * Other chains use HTTP getLogs polling to avoid eth_getFilterChanges.
 * @see https://www.alchemy.com/docs/reference/subscription-api-endpoints
 */
export const ALCHEMY_WEBSOCKET_SUPPORTED_CHAINS: number[] = [1, 137, 42161, 8453];

export function isAlchemyWebSocketSupported(chainId: number): boolean {
  return ALCHEMY_WEBSOCKET_SUPPORTED_CHAINS.includes(chainId);
}

/**
 * Map chain ID to Alchemy network identifier for Prices API
 * Used for the "by-address" endpoint which requires network parameter
 */
export function getAlchemyNetworkName(chainId: number): string | null {
  const networkMap: Record<number, string> = {
    // Mainnets
    1: 'eth-mainnet',
    8453: 'base-mainnet',
    137: 'polygon-mainnet',
    42161: 'arb-mainnet',
    100: 'gnosis-mainnet',
    
    // Testnets
    11155111: 'eth-sepolia',
    84532: 'base-sepolia',
    80001: 'polygon-mumbai',
  };

  return networkMap[chainId] || null;
}

/**
 * Get Alchemy Portfolio API base URL
 * Used for Alchemy's Portfolio API endpoints (unified multi-chain asset fetching)
 * https://www.alchemy.com/docs/reference/portfolio-apis
 */
export function getAlchemyPortfolioApiUrl(): string | null {
  const alchemyApiKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyApiKey) {
    return null;
  }
  // Portfolio API uses: https://api.g.alchemy.com/data/v1/{apiKey}
  return `https://api.g.alchemy.com/data/v1/${alchemyApiKey}`;
}
