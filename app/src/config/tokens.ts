import { clearContracts } from '@/lib/clearNetwork';
import { readEnv } from '@/config/clientEnv';
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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Committed fallbacks so the deployed CLRUSD is recognized even if the VITE_CLRUSD_<chainId> env
// isn't set on the host (these are public token addresses, not secrets). Env still overrides.
// Base Sepolia is deliberately absent: it comes from `clearNetwork`, which is where the app
// already keeps the pair it transacts against. Keeping a second copy here is exactly what left a
// retired token still showing up as somebody's savings -- a token is identified by its address,
// and the symbol is a label two of our own contracts happened to share.
const CLRUSD_FALLBACK: Record<number, string> = {
  8453: '0xa7a257f411e4Fe98e1D1FaA36C84B864c3336583', // Base mainnet
  11155111: '0x54Dd3449Eb54adC02C33cD880178BfA718991753', // Ethereum Sepolia
};

/**
 * The CLRUSD contract for a chain.
 *
 * `clearNetwork` wins wherever it has an answer, and env only speaks for chains it does not cover.
 * That is the opposite of the usual precedence and it is deliberate: clearNetwork holds the pair
 * the app actually transacts against, so a different address here would be showing a member a
 * balance in a token their deposits do not mint. There is no version of that which is right.
 *
 * It also gives up nothing. `import.meta.env` is inlined by Vite at build time, so changing
 * VITE_CLRUSD_84532 has always required a rebuild -- exactly like editing clearNetwork. The
 * override bought no flexibility and cost a second source of truth, which is how a retired token
 * went on showing as somebody's savings for as long as it did.
 */
function readClrUsdAddress(chainId: number): string {
  const fromNetwork = clearContracts(chainId)?.clrusd;
  if (fromNetwork) return fromNetwork;

  const key = `VITE_CLRUSD_${chainId}`;
  const raw = readEnv(key); // not import.meta.env[key] — see src/config/clientEnv.ts
  if (raw && /^0x[a-fA-F0-9]{40}$/.test(raw) && raw !== ZERO_ADDRESS) {
    return raw;
  }
  return CLRUSD_FALLBACK[chainId] ?? ZERO_ADDRESS;
}

/**
 * Common ERC20 tokens by chain ID
 * Used by token balance hooks across the application
 */
export const COMMON_TOKENS: Record<number, TokenConfig[]> = {
  // Ethereum Mainnet
  1: [
    ...(readClrUsdAddress(1) !== ZERO_ADDRESS
      ? [{ address: readClrUsdAddress(1), symbol: 'CLRUSD', name: 'Clear USD', decimals: 6 } as TokenConfig]
      : []),
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
  // Optimism Mainnet
  10: [
    ...(readClrUsdAddress(10) !== ZERO_ADDRESS
      ? [{ address: readClrUsdAddress(10), symbol: 'CLRUSD', name: 'Clear USD', decimals: 6 } as TokenConfig]
      : []),
    {
      address: '0x0b2C639c533813f4Aa9D7837CaF62653d097Ff85',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6
    },
    {
      address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
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
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18
    },
    {
      address: '0x4200000000000000000000000000000000000042',
      symbol: 'OP',
      name: 'Optimism',
      decimals: 18
    },
  ],
  // Base Mainnet
  8453: [
    ...(readClrUsdAddress(8453) !== ZERO_ADDRESS
      ? [{ address: readClrUsdAddress(8453), symbol: 'CLRUSD', name: 'Clear USD', decimals: 6 } as TokenConfig]
      : []),
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
    ...(readClrUsdAddress(11155111) !== ZERO_ADDRESS
      ? [{ address: readClrUsdAddress(11155111), symbol: 'CLRUSD', name: 'Clear USD', decimals: 6 } as TokenConfig]
      : []),
    { 
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 
      symbol: 'USDC', 
      name: 'USD Coin', 
      decimals: 6 
    },
  ],
  // Base Sepolia Testnet
  84532: [
    ...(readClrUsdAddress(84532) !== ZERO_ADDRESS
      ? [{ address: readClrUsdAddress(84532), symbol: 'CLRUSD', name: 'Clear USD', decimals: 6 } as TokenConfig]
      : []),
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
    ...(readClrUsdAddress(42161) !== ZERO_ADDRESS
      ? [{ address: readClrUsdAddress(42161), symbol: 'CLRUSD', name: 'Clear USD', decimals: 6 } as TokenConfig]
      : []),
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
    ...(readClrUsdAddress(137) !== ZERO_ADDRESS
      ? [{ address: readClrUsdAddress(137), symbol: 'CLRUSD', name: 'Clear USD', decimals: 6 } as TokenConfig]
      : []),
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
    ...(readClrUsdAddress(100) !== ZERO_ADDRESS
      ? [{ address: readClrUsdAddress(100), symbol: 'CLRUSD', name: 'Clear USD', decimals: 6 } as TokenConfig]
      : []),
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
