/**
 * Common token configurations across all chains
 * Centralized token definitions to avoid duplication
 */

export interface TokenConfig {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}

/**
 * Common ERC20 tokens by chain ID
 * Used by token balance hooks across the application
 */
export const COMMON_TOKENS: Record<number, TokenConfig[]> = {
  // Ethereum Mainnet
  1: [
    { 
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 
      symbol: 'USDC', 
      name: 'USD Coin', 
      decimals: 6 
    },
    { 
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', 
      symbol: 'USDT', 
      name: 'Tether USD', 
      decimals: 6 
    },
    { 
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', 
      symbol: 'DAI', 
      name: 'Dai Stablecoin', 
      decimals: 18 
    },
    { 
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 
      symbol: 'WETH', 
      name: 'Wrapped Ether', 
      decimals: 18 
    },
  ],
  // Base Mainnet
  8453: [
    { 
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 
      symbol: 'USDC', 
      name: 'USD Coin', 
      decimals: 6 
    },
    { 
      address: '0x4200000000000000000000000000000000000006', 
      symbol: 'WETH', 
      name: 'Wrapped Ether', 
      decimals: 18 
    },
  ],
  // Sepolia Testnet
  11155111: [
    { 
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 
      symbol: 'USDC', 
      name: 'USD Coin', 
      decimals: 6 
    },
  ],
  // Base Sepolia Testnet
  84532: [
    { 
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 
      symbol: 'USDC', 
      name: 'USD Coin', 
      decimals: 6 
    },
    { 
      address: '0x4200000000000000000000000000000000000006', 
      symbol: 'WETH', 
      name: 'Wrapped Ether', 
      decimals: 18 
    },
  ],
};

/**
 * Get common tokens for a specific chain
 * @param chainId - The chain ID
 * @returns Array of token configurations for the chain, or empty array if not found
 */
export const getCommonTokens = (chainId: number): TokenConfig[] => {
  return COMMON_TOKENS[chainId] || [];
};

/**
 * Check if a token is a stablecoin
 * @param symbol - Token symbol
 * @returns true if the token is a stablecoin
 */
export const isStablecoin = (symbol: string): boolean => {
  return ['USDC', 'USDT', 'DAI'].includes(symbol);
};
