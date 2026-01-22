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
  // Arbitrum One
  42161: [
    { 
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 
      symbol: 'USDC', 
      name: 'USD Coin', 
      decimals: 6 
    },
    { 
      address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 
      symbol: 'USDT', 
      name: 'Tether USD', 
      decimals: 6 
    },
    { 
      address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 
      symbol: 'DAI', 
      name: 'Dai Stablecoin', 
      decimals: 18 
    },
    { 
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 
      symbol: 'WETH', 
      name: 'Wrapped Ether', 
      decimals: 18 
    },
  ],
  // Polygon
  137: [
    { 
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 
      symbol: 'USDC', 
      name: 'USD Coin', 
      decimals: 6 
    },
    { 
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 
      symbol: 'USDT', 
      name: 'Tether USD', 
      decimals: 6 
    },
    { 
      address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', 
      symbol: 'DAI', 
      name: 'Dai Stablecoin', 
      decimals: 18 
    },
    { 
      address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 
      symbol: 'WETH', 
      name: 'Wrapped Ether', 
      decimals: 18 
    },
    { 
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', 
      symbol: 'WMATIC', 
      name: 'Wrapped MATIC', 
      decimals: 18 
    },
  ],
  // Gnosis
  100: [
    { 
      address: '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83', 
      symbol: 'USDC', 
      name: 'USD Coin', 
      decimals: 6 
    },
    { 
      address: '0x4ECaBa5870353805a9F068101A40E0f32ed605C6', 
      symbol: 'USDT', 
      name: 'Tether USD', 
      decimals: 6 
    },
    { 
      address: '0xe91D153E0b41518A2Ce8Dd3D7944F8638934d2C8', 
      symbol: 'WXDAI', 
      name: 'Wrapped xDAI', 
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

